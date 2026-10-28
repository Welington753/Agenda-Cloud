// Executor dos avisos Web Push de NOVAS solicitações.
//
// O QUE GARANTE QUE NADA SE PERDE É A TABELA, NÃO O PROCESSO: o evento
// (`booking_request_alerts`) é gravado na transação do pedido. Este executor
// só lê eventos vencidos e tenta entregá-los. Quando ele roda:
//
//  1. logo depois do commit de um pedido novo (`depoisDoPedido`), sem
//     segurar a resposta do cliente;
//  2. quando a API sobe (`onApplicationBootstrap`) — no Render gratuito, o
//     serviço hiberna sem tráfego e acorda na próxima requisição, e o
//     deploy reinicia o processo: o que ficou pendente é retomado aí;
//  3. pegando carona em tráfego REAL que já existe (`aproveitarTrafego`,
//     no máximo uma vez por minuto): a consulta da lista de solicitações
//     pela área real e os pedidos públicos. Nenhum ping, nenhum timer
//     periódico, nenhum Cron Job.
//
// Se o processo morrer entre o commit e o envio, o evento fica `PENDING` (ou
// `PROCESSING` com concessão por tempo) no banco e sai no próximo 2 ou 3 —
// ou expira em `not_after` (24 h, ou o início do atendimento) sem avisar
// fora de hora. Com o serviço hibernado e sem nenhum tráfego, NADA roda até
// alguém acessar: é o limite real da infraestrutura gratuita.
//
// Para cada evento: a solicitação ainda está `PENDING`? O estabelecimento
// está ativo? Quem pode receber AGORA (inscrição ativa, sessão viva, vínculo
// e permissão de ver a agenda revalidados)? Cada aparelho tem a sua linha
// em `push_deliveries`: `ACCEPTED` é aceitação pelo serviço de push (HTTP
// 201), NÃO prova de exibição. Falha de push nunca toca na reserva.
//
// Logs: só contagens, ids internos, status HTTP e o HOST do serviço de push.
// Nunca endpoint completo, chave do aparelho, chave VAPID ou dado do cliente.
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';
import { canReceiveBookingAlerts } from '../appointments/appointment-access.js';
import { isTenantUsableForSession } from '../auth/tenant-access.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { AppointmentStatus } from '../entities/enums/appointment-status.enum.js';
import type { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { generateId } from '../entities/common/generate-id.js';
import {
  concluirAlerta,
  concluirEntrega,
  destinatarios,
  expirarVencidos,
  iniciarEntrega,
  negacoesDoVinculo,
  reservarAlertas,
  situacaoDaSolicitacao,
  type AlertaReservado,
  type StatusDaEntrega,
} from './booking-alerts.repository.js';
import { lerChavesVapid } from './push-config.js';
import { endpointAceito, hostParaLog } from './push-endpoint.js';
import { marcarExpirada, registrarResultado } from './push-subscriptions.repository.js';
import { transporteHttps, type RespostaPush, type TransportePush } from './push-transport.js';
import { cabecalhoVapid, cifrarConteudo, type ChavesVapid } from './web-push-crypto.js';

/** Espera antes de tentar de novo, por tentativa já feita. */
const ESPERAS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
const MAXIMO_DE_TENTATIVAS = 5;
const CONCESSAO_MS = 2 * 60_000;
const LIMITE_POR_LOTE = 20;
const FALHAS_PARA_REVOGAR = 5;
const INTERVALO_MINIMO_DE_CARONA_MS = 60_000;
/** Máximo que um serviço de push guarda a mensagem com o aparelho offline. */
const TTL_MAXIMO_S = 24 * 60 * 60;

/** Conteúdo cifrado que vai para o aparelho: só ids, nenhum dado pessoal.
 * O texto exibido é fixo e genérico, montado pelo service worker. */
export interface ConteudoDoPush {
  v: 1;
  tipo: 'nova-solicitacao';
  estabelecimento: string;
  solicitacao: string;
}

export interface OpcoesDoDisparador {
  chaves?: ChavesVapid | null;
  transporte?: TransportePush;
  agora?: () => Date;
  executor?: string;
}

export interface ResumoDoDisparo {
  desativado: boolean;
  expirados: number;
  processados: number;
  aceitas: number;
  falhas: number;
  repetir: number;
}

type ResultadoDoAparelho = { status: StatusDaEntrega; http: number | null; motivo: string };

/** Classifica a resposta do serviço de push. */
export function classificarResposta(resposta: RespostaPush): ResultadoDoAparelho {
  if (resposta.tipo === 'rede') return { status: 'RETRY', http: null, motivo: 'SEM_RESPOSTA' };
  const s = resposta.status;
  if (s >= 200 && s < 300) return { status: 'ACCEPTED', http: s, motivo: 'ACEITO_PELO_SERVICO' };
  if (s === 404 || s === 410) return { status: 'GONE', http: s, motivo: 'INSCRICAO_EXPIRADA' };
  if (s === 429 || s >= 500) return { status: 'RETRY', http: s, motivo: 'RECUSA_TEMPORARIA' };
  return { status: 'FAILED', http: s, motivo: 'RECUSA_DEFINITIVA' };
}

@Injectable()
export class DisparadorDePush implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('WebPush');
  private readonly chaves: ChavesVapid | null;
  private readonly transporte: TransportePush;
  private readonly agora: () => Date;
  private readonly executor: string;
  private emAndamento: Promise<ResumoDoDisparo> | null = null;
  private deNovo = false;
  private ultimaCarona = 0;
  private encerrando = false;

  constructor(
    private readonly dataSource: DataSource,
    @Optional() config?: ConfigService,
    @Optional() opcoes?: OpcoesDoDisparador,
  ) {
    this.chaves = opcoes?.chaves !== undefined ? opcoes.chaves : config ? lerChavesVapid(config) : null;
    this.transporte = opcoes?.transporte ?? transporteHttps;
    this.agora = opcoes?.agora ?? (() => new Date());
    this.executor = opcoes?.executor ?? `${hostname()}:${process.pid}:${generateId().slice(0, 8)}`;
  }

  get habilitado(): boolean {
    return this.chaves !== null;
  }

  get chavePublica(): string | null {
    return this.chaves?.publicKey ?? null;
  }

  onApplicationBootstrap(): void {
    // Retomada do que ficou pendente antes de hibernar/reiniciar.
    this.agendar();
  }

  onModuleDestroy(): void {
    this.encerrando = true;
  }

  /** Chamado DEPOIS do commit de um pedido novo. Nunca lança e nunca
   * segura a resposta de quem pediu. */
  depoisDoPedido(): void {
    this.agendar();
  }

  /** Carona em tráfego real, no máximo uma vez por minuto. */
  aproveitarTrafego(): void {
    const agora = Date.now();
    if (agora - this.ultimaCarona < INTERVALO_MINIMO_DE_CARONA_MS) return;
    this.ultimaCarona = agora;
    this.agendar();
  }

  private agendar(): void {
    if (this.encerrando) return;
    setImmediate(() => {
      this.executar().catch((erro: unknown) => {
        this.logger.error(`falha no executor: ${erro instanceof Error ? erro.name : 'erro'}`);
      });
    });
  }

  /** Um lote por vez neste processo; chamadas no meio pedem mais uma rodada. */
  async executar(): Promise<ResumoDoDisparo> {
    if (this.emAndamento) {
      this.deNovo = true;
      return this.emAndamento;
    }
    this.emAndamento = (async () => {
      let resumo = await this.processarLote();
      while (this.deNovo && !this.encerrando) {
        this.deNovo = false;
        resumo = await this.processarLote();
      }
      return resumo;
    })();
    try {
      return await this.emAndamento;
    } finally {
      this.emAndamento = null;
    }
  }

  async processarLote(): Promise<ResumoDoDisparo> {
    const resumo: ResumoDoDisparo = { desativado: false, expirados: 0, processados: 0, aceitas: 0, falhas: 0, repetir: 0 };
    // Sem banco conectado (testes HTTP com DataSource falso): nada a fazer.
    if (!this.dataSource.isInitialized) return { ...resumo, desativado: true };
    const manager = this.dataSource.manager;
    resumo.expirados = await expirarVencidos(manager, this.agora());
    if (!this.chaves) return { ...resumo, desativado: true };

    const alertas = await reservarAlertas(manager, this.executor, this.agora(), LIMITE_POR_LOTE, CONCESSAO_MS);
    for (const alerta of alertas) {
      const r = await this.processarAlerta(alerta, this.chaves);
      resumo.processados += 1;
      resumo.aceitas += r.aceitas;
      resumo.falhas += r.falhas;
      resumo.repetir += r.repetir;
    }
    if (alertas.length > 0 || resumo.expirados > 0) {
      this.logger.log(
        `lote: eventos=${alertas.length} expirados=${resumo.expirados} aceitas=${resumo.aceitas} falhas=${resumo.falhas} repetir=${resumo.repetir}`,
      );
    }
    return resumo;
  }

  private async processarAlerta(
    alerta: AlertaReservado,
    chaves: ChavesVapid,
  ): Promise<{ aceitas: number; falhas: number; repetir: number }> {
    const manager = this.dataSource.manager;
    const dono = { id: alerta.id, executor: this.executor };
    const contagem = { aceitas: 0, falhas: 0, repetir: 0 };

    const situacao = await situacaoDaSolicitacao(manager, alerta.tenant_id, alerta.appointment_id);
    if (!situacao || situacao.status !== AppointmentStatus.PENDING) {
      await concluirAlerta(manager, dono, { status: 'DONE', motivo: 'SOLICITACAO_RESPONDIDA', agora: this.agora() });
      return contagem;
    }
    if (!isTenantUsableForSession(situacao.tenant_status as TenantStatus)) {
      await concluirAlerta(manager, dono, { status: 'DONE', motivo: 'ESTABELECIMENTO_INATIVO', agora: this.agora() });
      return contagem;
    }

    const conteudo: ConteudoDoPush = {
      v: 1,
      tipo: 'nova-solicitacao',
      estabelecimento: alerta.tenant_id,
      solicitacao: alerta.appointment_id,
    };
    const corpo = Buffer.from(JSON.stringify(conteudo));

    for (const d of await destinatarios(manager, alerta, this.agora())) {
      const negacoes = await negacoesDoVinculo(manager, alerta.tenant_id, d.membership_id);
      const podeVer = canReceiveBookingAlerts(
        d.role as EstablishmentRole,
        negacoes as unknown as PermissionOverrideLike[],
      );
      const destino = endpointAceito(d.endpoint);
      if (!podeVer || !destino) {
        await iniciarEntrega(
          manager,
          {
            alertId: alerta.id,
            subscriptionId: d.subscription_id,
            tenantId: alerta.tenant_id,
            status: 'SKIPPED',
            motivo: podeVer ? 'DESTINO_RECUSADO' : 'SEM_PERMISSAO',
          },
          this.agora(),
        );
        continue;
      }

      const entregaId = await iniciarEntrega(
        manager,
        { alertId: alerta.id, subscriptionId: d.subscription_id, tenantId: alerta.tenant_id, status: 'SENDING' },
        this.agora(),
      );

      let resultado: ResultadoDoAparelho;
      try {
        const agora = this.agora();
        const ttl = Math.max(0, Math.min(TTL_MAXIMO_S, Math.floor((new Date(alerta.not_after).getTime() - agora.getTime()) / 1000)));
        const resposta = await this.transporte.enviar({
          url: destino,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            TTL: String(ttl),
            Urgency: 'high',
            // Mesmo tópico = o serviço substitui a mensagem ainda não
            // entregue em vez de acumular (reenvio depois de falha).
            Topic: alerta.id.slice(0, 32),
            Authorization: cabecalhoVapid(destino, chaves, agora),
          },
          body: cifrarConteudo(corpo, { p256dh: d.p256dh, auth: d.auth }),
        });
        resultado = classificarResposta(resposta);
      } catch {
        // Montagem ou transporte lançaram (o transporte real nunca lança):
        // definitivo para este evento, sem repetir em laço.
        resultado = { status: 'FAILED', http: null, motivo: 'ERRO_INTERNO' };
      }

      const agora = this.agora();
      await concluirEntrega(manager, entregaId, { status: resultado.status, httpStatus: resultado.http, motivo: resultado.motivo, agora });
      if (resultado.status === 'ACCEPTED') {
        contagem.aceitas += 1;
        await registrarResultado(manager, d.subscription_id, true, agora, FALHAS_PARA_REVOGAR);
      } else if (resultado.status === 'GONE') {
        contagem.falhas += 1;
        await marcarExpirada(manager, d.subscription_id, agora);
      } else if (resultado.status === 'RETRY') {
        contagem.repetir += 1;
      } else {
        contagem.falhas += 1;
        await registrarResultado(manager, d.subscription_id, false, agora, FALHAS_PARA_REVOGAR);
        this.logger.warn(`recusa do serviço de push: http=${resultado.http ?? '-'} host=${hostParaLog(d.endpoint)}`);
      }
    }

    const agora = this.agora();
    const espera = ESPERAS_MS[Math.min(alerta.attempts - 1, ESPERAS_MS.length - 1)];
    const proxima = new Date(agora.getTime() + espera);
    if (
      contagem.repetir > 0 &&
      alerta.attempts < MAXIMO_DE_TENTATIVAS &&
      proxima.getTime() < new Date(alerta.not_after).getTime()
    ) {
      await concluirAlerta(manager, dono, { status: 'PENDING', motivo: 'NOVA_TENTATIVA', agora, proximaTentativa: proxima });
    } else {
      const motivo =
        contagem.aceitas > 0 ? 'ACEITO_PELO_SERVICO' : contagem.repetir + contagem.falhas > 0 ? 'SEM_SUCESSO' : 'SEM_DESTINATARIOS';
      await concluirAlerta(manager, dono, { status: 'DONE', motivo, agora });
    }
    return contagem;
  }
}
