// Executor das notificações programadas. Roda FORA de qualquer requisição de
// usuário, chamado por um agendador externo (ver o plano, "Execução apesar
// da hibernação") — nunca por `setInterval`/timer em memória: o que garante
// que nada se perde é a tabela, não o processo.
//
// Ciclo de UMA tarefa:
//
//  1. RESERVA (um UPDATE ... FOR UPDATE SKIP LOCKED): a linha vira
//     `PROCESSING` para este executor, com concessão por tempo. Dois
//     executores nunca pegam a mesma linha.
//  2. CONFERÊNCIA, numa transação curta com a reserva travada `FOR SHARE`:
//     situação atual (CONFIRMED), início vigente igual ao programado,
//     atendimento ainda no futuro, dentro do prazo, cliente com autorização
//     de contato e telefone utilizável. Falhou: `SKIPPED` com o motivo.
//     Passou: `SENDING`, gravado e COMMITADO antes de qualquer chamada
//     externa. Quem cancela a reserva trava a mesma linha `FOR UPDATE`, então
//     ou a conferência vê o cancelamento, ou o cancelamento acontece depois
//     da decisão de enviar (janela residual documentada no plano).
//  3. ENVIO, fora de transação.
//  4. RESULTADO: `SENT` (aceita pelo provedor — não é entrega), `FAILED`,
//     de volta à fila com espera crescente (recusa temporária), ou
//     `UNCERTAIN` (sem resposta conclusiva de provedor não idempotente).
//
// A reserva NUNCA é alterada aqui: falha do provedor não muda status, horário
// nem nada do agendamento.
//
// Entrega exatamente uma vez NÃO é prometida: entre o provedor aceitar e o
// resultado ser gravado, o processo pode morrer. Essa linha fica `SENDING` e,
// vencida a concessão, vira `UNCERTAIN` (ou volta à fila, se o provedor for
// idempotente pela chave da tarefa).
import type { DataSource } from 'typeorm';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { AppointmentStatus } from '../entities/enums/appointment-status.enum.js';
import { montarMensagem, telefoneInternacional } from './notification-messages.js';
import { linhasDe } from '../common/linhas-de.js';
import {
  reservarTarefasVencidas,
  resolverEnviosAbandonados,
  transicionar,
  type TarefaDeNotificacao,
} from './notification-jobs.repository.js';
import type { MensagemParaEnviar, ProvedorWhatsapp, ResultadoDoEnvio } from './whatsapp-provider.js';

/** Espera antes da nova tentativa, por número de tentativas já feitas. */
const ESPERA_POR_TENTATIVA_MIN = [1, 5, 30, 120];
const MINUTO_MS = 60_000;

export interface OpcoesDoExecutor {
  /** Desligado por padrão: sem isto, `processarLote` não toca em nada. */
  envioHabilitado?: boolean;
  provedor?: ProvedorWhatsapp | null;
  /** Identificador deste executor (aparece em `locked_by`). */
  executor: string;
  agora?: () => Date;
  limite?: number;
  concessaoMs?: number;
  maximoDeTentativas?: number;
}

export interface ResumoDoLote {
  desativado: boolean;
  reservadas: number;
  aceitas: number;
  puladas: number;
  falhas: number;
  incertas: number;
  reprogramadas: number;
  perdidas: number;
  abandonadasResolvidas: number;
}

interface SituacaoDaReserva {
  status: AppointmentStatus;
  start_at: Date;
  consumer_name: string;
  whatsapp_normalized: string | null;
  whatsapp_opt_in_at: Date | null;
  whatsapp_opt_out_at: Date | null;
  timezone: string;
  tenant_status: TenantStatus;
  unit_name: string;
}

const ESTABELECIMENTO_ATIVO: ReadonlySet<TenantStatus> = new Set([
  TenantStatus.ACTIVE,
  TenantStatus.TRIAL,
]);

/** Motivo para NÃO enviar, ou `null` quando tudo confere. */
export function motivoParaNaoEnviar(
  tarefa: Pick<TarefaDeNotificacao, 'appointment_start_at' | 'not_after'>,
  situacao: SituacaoDaReserva | null,
  agora: Date,
): string | null {
  if (!situacao) return 'RESERVA_INEXISTENTE';
  if (!ESTABELECIMENTO_ATIVO.has(situacao.tenant_status)) return 'ESTABELECIMENTO_INATIVO';
  if (situacao.status !== AppointmentStatus.CONFIRMED) return 'RESERVA_NAO_CONFIRMADA';
  if (new Date(situacao.start_at).getTime() !== new Date(tarefa.appointment_start_at).getTime()) {
    return 'HORARIO_ALTERADO';
  }
  if (agora.getTime() >= new Date(situacao.start_at).getTime()) return 'ATENDIMENTO_JA_COMECOU';
  if (agora.getTime() > new Date(tarefa.not_after).getTime()) return 'FORA_DO_PRAZO';
  const autorizou = situacao.whatsapp_opt_in_at ? new Date(situacao.whatsapp_opt_in_at) : null;
  const revogou = situacao.whatsapp_opt_out_at ? new Date(situacao.whatsapp_opt_out_at) : null;
  if (!autorizou || (revogou && revogou.getTime() >= autorizou.getTime())) return 'SEM_AUTORIZACAO';
  if (!telefoneInternacional(situacao.whatsapp_normalized)) return 'TELEFONE_INVALIDO';
  return null;
}

export class ExecutorDeNotificacoes {
  private readonly agora: () => Date;
  private readonly limite: number;
  private readonly concessaoMs: number;
  private readonly maximoDeTentativas: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly opcoes: OpcoesDoExecutor,
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.limite = opcoes.limite ?? 20;
    this.concessaoMs = opcoes.concessaoMs ?? 5 * MINUTO_MS;
    this.maximoDeTentativas = opcoes.maximoDeTentativas ?? 5;
  }

  async processarLote(): Promise<ResumoDoLote> {
    const resumo: ResumoDoLote = {
      desativado: false,
      reservadas: 0,
      aceitas: 0,
      puladas: 0,
      falhas: 0,
      incertas: 0,
      reprogramadas: 0,
      perdidas: 0,
      abandonadasResolvidas: 0,
    };
    const provedor = this.opcoes.provedor;
    if (!this.opcoes.envioHabilitado || !provedor) return { ...resumo, desativado: true };

    const inicio = this.agora();
    resumo.abandonadasResolvidas = await resolverEnviosAbandonados(
      this.dataSource.manager,
      inicio,
      provedor.idempotente,
      this.maximoDeTentativas,
    );

    const tarefas = await reservarTarefasVencidas(
      this.dataSource.manager,
      this.opcoes.executor,
      inicio,
      this.limite,
      this.concessaoMs,
    );
    resumo.reservadas = tarefas.length;

    for (const tarefa of tarefas) {
      const desfecho = await this.processar(tarefa, provedor);
      resumo[desfecho] += 1;
    }
    return resumo;
  }

  private async processar(
    tarefa: TarefaDeNotificacao,
    provedor: ProvedorWhatsapp,
  ): Promise<'aceitas' | 'puladas' | 'falhas' | 'incertas' | 'reprogramadas' | 'perdidas'> {
    const executor = this.opcoes.executor;

    // 2. Conferência + decisão, numa transação curta.
    const decisao = await this.dataSource.transaction(async (tx) => {
      const agora = this.agora();
      const [situacao] = linhasDe<SituacaoDaReserva>(
        await tx.query(
          `SELECT a.status, a.start_at, c.name AS consumer_name, c.whatsapp_normalized,
                  c.whatsapp_opt_in_at, c.whatsapp_opt_out_at,
                  t.timezone, t.status AS tenant_status, u.name AS unit_name
             FROM appointments a
             JOIN consumers c ON c.tenant_id = a.tenant_id AND c.id = a.consumer_id
             JOIN tenants t ON t.id = a.tenant_id
             JOIN units u ON u.tenant_id = a.tenant_id AND u.id = a.unit_id
            WHERE a.tenant_id = $1 AND a.id = $2
            FOR SHARE OF a`,
          [tarefa.tenant_id, tarefa.appointment_id],
        ),
      );

      const motivo = motivoParaNaoEnviar(tarefa, situacao ?? null, agora);
      if (motivo) {
        const ok = await transicionar(
          tx,
          { id: tarefa.id, executor, de: 'PROCESSING' },
          { status: 'SKIPPED', agora, motivo },
        );
        return ok ? ('puladas' as const) : ('perdidas' as const);
      }

      const inicio = new Date(situacao!.start_at);
      const { parametros, texto } = montarMensagem(tarefa.kind, {
        nomeDoCliente: situacao!.consumer_name,
        estabelecimento: situacao!.unit_name,
        inicio,
        timezone: situacao!.timezone,
      });
      const mensagem: MensagemParaEnviar = {
        para: telefoneInternacional(situacao!.whatsapp_normalized)!,
        modelo: tarefa.kind,
        parametros,
        texto,
        chaveDeIdempotencia: tarefa.dedupe_key,
      };
      // Decisão de enviar gravada ANTES da chamada externa.
      const ok = await transicionar(
        tx,
        { id: tarefa.id, executor, de: 'PROCESSING' },
        { status: 'SENDING', agora, concessaoAte: new Date(agora.getTime() + this.concessaoMs) },
      );
      return ok ? mensagem : ('perdidas' as const);
    });

    if (typeof decisao === 'string') return decisao;

    // 3. Envio, fora de transação.
    let resultado: ResultadoDoEnvio;
    try {
      resultado = await provedor.enviar(decisao);
    } catch (erro) {
      resultado = { tipo: 'incerta', erro: erro instanceof Error ? erro.message : String(erro) };
    }

    // 4. Resultado.
    const agora = this.agora();
    const daLinha = { id: tarefa.id, executor, de: 'SENDING' as const };
    const manager = this.dataSource.manager;

    if (resultado.tipo === 'aceita') {
      await transicionar(manager, daLinha, {
        status: 'SENT',
        agora,
        idDaMensagem: resultado.idDaMensagem,
      });
      return 'aceitas';
    }

    const espera = ESPERA_POR_TENTATIVA_MIN[Math.min(tarefa.attempts - 1, ESPERA_POR_TENTATIVA_MIN.length - 1)];
    const novaTentativa = new Date(agora.getTime() + espera * MINUTO_MS);
    const cabeNoPrazo = novaTentativa.getTime() <= new Date(tarefa.not_after).getTime();
    const podeRepetir =
      tarefa.attempts < this.maximoDeTentativas &&
      cabeNoPrazo &&
      (resultado.tipo === 'recusada' ? !resultado.definitiva : provedor.idempotente);

    if (podeRepetir) {
      await transicionar(manager, daLinha, {
        status: 'SCHEDULED',
        agora,
        erro: resultado.erro,
        reprogramarPara: novaTentativa,
      });
      return 'reprogramadas';
    }

    if (resultado.tipo === 'incerta') {
      await transicionar(manager, daLinha, {
        status: 'UNCERTAIN',
        agora,
        motivo: 'RESULTADO_INCERTO',
        erro: resultado.erro,
      });
      return 'incertas';
    }

    await transicionar(manager, daLinha, {
      status: 'FAILED',
      agora,
      motivo: resultado.definitiva ? 'RECUSA_DEFINITIVA' : 'TENTATIVAS_ESGOTADAS',
      erro: resultado.erro,
    });
    return 'falhas';
  }
}
