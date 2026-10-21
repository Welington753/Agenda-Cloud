// Contrato com o provedor de WhatsApp. Nenhuma implementação real existe
// neste lote: o executor só roda com envio HABILITADO e com um provedor
// passado explicitamente (nos testes, `ProvedorWhatsappSimulado`). Ligar o
// envio real exige número verificado, templates aprovados e credenciais —
// ver docs/plans/agendamento-publico-e-notificacoes.md, Lote E.
import type { TipoDeNotificacao } from './notification-policy.js';

export interface MensagemParaEnviar {
  /** Telefone internacional só com dígitos (ex.: 5511900000000). */
  para: string;
  /** Modelo (template) da mensagem — na API oficial, um template aprovado. */
  modelo: TipoDeNotificacao;
  /** Valores do modelo, na ordem. Nunca dados do serviço. */
  parametros: string[];
  /** Texto equivalente, para registro e para provedores sem template. */
  texto: string;
  /** Mesma chave para a mesma tarefa: provedor idempotente descarta repetição. */
  chaveDeIdempotencia: string;
}

/**
 * Resultado de UMA tentativa:
 * - `aceita`: o provedor aceitou e devolveu o id da mensagem. NÃO é entrega —
 *   a entrega chega depois, pelo retorno do provedor (`DELIVERED`).
 * - `recusada`: o provedor respondeu que NÃO aceitou. `definitiva` (número
 *   inválido, sem permissão, template recusado) não é repetida; a temporária
 *   (limite de taxa, indisponível) volta para a fila.
 * - `incerta`: sem resposta conclusiva (tempo esgotado, conexão caiu depois
 *   de enviar). Pode ter sido aceita.
 */
export type ResultadoDoEnvio =
  | { tipo: 'aceita'; idDaMensagem: string }
  | { tipo: 'recusada'; definitiva: boolean; erro: string }
  | { tipo: 'incerta'; erro: string };

export interface ProvedorWhatsapp {
  /** `true` só se o provedor garante descartar a mesma `chaveDeIdempotencia`
   * repetida. Sem isso, resultado incerto nunca é reenviado sozinho. */
  readonly idempotente: boolean;
  enviar(mensagem: MensagemParaEnviar): Promise<ResultadoDoEnvio>;
}

/**
 * Provedor de teste: grava o que "enviaria" e responde o que o teste mandar.
 * Não abre conexão nenhuma.
 */
export class ProvedorWhatsappSimulado implements ProvedorWhatsapp {
  readonly enviadas: MensagemParaEnviar[] = [];
  private proximos: (ResultadoDoEnvio | Error)[] = [];
  private contador = 0;

  constructor(readonly idempotente = false) {}

  /** Próximas respostas, em ordem; esgotadas, volta a aceitar. */
  responder(...resultados: (ResultadoDoEnvio | Error)[]): void {
    this.proximos.push(...resultados);
  }

  async enviar(mensagem: MensagemParaEnviar): Promise<ResultadoDoEnvio> {
    this.enviadas.push(mensagem);
    const proximo = this.proximos.shift();
    if (proximo instanceof Error) throw proximo;
    if (proximo) return proximo;
    this.contador += 1;
    return { tipo: 'aceita', idDaMensagem: `simulada-${this.contador}-${mensagem.chaveDeIdempotencia}` };
  }
}
