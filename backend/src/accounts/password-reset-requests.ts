// "Esqueci minha senha": o pedido público e o executor que o resolve.
//
// RESPOSTA PÚBLICA. `enqueue` só grava o identificador digitado em
// `password_reset_requests` e devolve. A rota responde 202, sempre igual, sem
// procurar a conta e sem esperar o provedor de e-mail: o trabalho da
// requisição é o mesmo exista a conta ou não. O limite por IP (429) fica na
// rota e não depende da conta.
//
// EXECUTOR, fora da requisição. Disparado logo depois de cada pedido, na
// subida da API e a cada minuto enquanto ela está acordada. O que garante
// que nada se perde é a tabela, não o processo: um pedido ou envio
// interrompido por uma reinicialização é retomado na próxima rodada.
//
//  1. PEDIDO (uma transação, linha travada com SKIP LOCKED): procura a conta
//     pelo e-mail OU pelo login, trava a linha da conta (`FOR UPDATE`) e
//     decide (`decidirPedido`). Só uma conta ativa, com senha e com e-mail
//     CONFIRMADO recebe link; um login que só parece e-mail nunca recebe nada.
//     Um link pendente ainda válido, inclusive o da administração, é
//     preservado (nada novo é emitido). O identificador é apagado ao final.
//  2. ENVIO (por link devido, `delivery_due_at`): numa transação curta, com a
//     linha travada, confere de novo a conta, emite um token NOVO, grava só o
//     hash e uma concessão de 2 minutos, e faz o commit. Depois envia, fora da
//     transação. O token em texto só existe na memória entre o commit e o
//     envio; se o processo morrer aí, vencida a concessão, o próximo envio
//     emite outro token (o anterior deixa de valer). Entrega exatamente uma
//     vez não é prometida: no pior caso chegam dois e-mails e vale o último.
//
// Nunca vai para log: identificador, e-mail, nome, token, link ou mensagem de
// erro do banco (que pode ecoar valores). Só contagens e códigos.
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { generateId } from '../entities/common/generate-id.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import type { EmailSendResult } from '../email/email-sender.js';
import { AccountDelivery } from './account-delivery.js';
import { emailDeRedefinicaoSolicitada, linkDeRedefinicao } from './account-emails.js';
import { SELF_SERVICE_LINK_TTL_MS, generateAccountToken } from './account-token.js';

/** Links de autoatendimento emitidos por conta a cada hora. Acima disso o
 * pedido é registrado e nada é enviado; a resposta pública não muda. */
export const SELF_SERVICE_HOURLY_LIMIT = 3;
const HORA_MS = 60 * 60 * 1000;

/** Concessão do envio: enquanto vale, nenhuma outra rodada pega o link. */
export const DELIVERY_LEASE_MS = 2 * 60 * 1000;
/** Tentativas de envio por link (a recusa do provedor volta à fila). */
export const MAX_DELIVERY_ATTEMPTS = 3;
/** Espera antes da nova tentativa, pelo número de tentativas já feitas. */
const ESPERA_POR_TENTATIVA_MS = [60 * 1000, 5 * 60 * 1000];

/** Pedidos já resolvidos (sem o identificador) ficam 30 dias. */
export const PROCESSED_REQUEST_RETENTION_MS = 30 * 24 * HORA_MS;
export const SWEEP_INTERVAL_MS = 60 * 1000;
const LOTE = 25;

export type RequestOutcome = 'ISSUED' | 'NO_MATCH' | 'NOT_ELIGIBLE' | 'ACTIVE_LINK_KEPT' | 'ACCOUNT_LIMIT';

export interface ContaDoPedido {
  status: string;
  has_credential: boolean;
  email: string | null;
  email_verified: boolean;
}

/** Recebe link por "Esqueci minha senha": conta ativa, com senha e com
 * e-mail confirmado. E-mail preenchido sem confirmação não basta. */
export function contaElegivel(conta: ContaDoPedido): boolean {
  return conta.status === 'ACTIVE' && conta.has_credential && !!conta.email && conta.email_verified;
}

export function decidirPedido(entrada: {
  contas: readonly ContaDoPedido[];
  linkPendenteValido: boolean;
  emitidosNaUltimaHora: number;
}): RequestOutcome {
  if (entrada.contas.length === 0) return 'NO_MATCH';
  // O banco impede o mesmo texto como e-mail de uma conta e login de outra;
  // se ainda assim houver duas, ninguém recebe.
  if (entrada.contas.length > 1 || !contaElegivel(entrada.contas[0])) return 'NOT_ELIGIBLE';
  if (entrada.linkPendenteValido) return 'ACTIVE_LINK_KEPT';
  if (entrada.emitidosNaUltimaHora >= SELF_SERVICE_HOURLY_LIMIT) return 'ACCOUNT_LIMIT';
  return 'ISSUED';
}

/** Próximo envio depois do resultado, ou `null` (terminou). `tentativas`
 * já conta o envio que acabou de acontecer. */
export function proximoEnvio(
  resultado: EmailSendResult,
  tentativas: number,
  agora: Date,
  expiraEm: Date,
): Date | null {
  if (resultado.status !== 'FAILED' || tentativas >= MAX_DELIVERY_ATTEMPTS) return null;
  const espera = ESPERA_POR_TENTATIVA_MS[Math.min(Math.max(tentativas, 1), ESPERA_POR_TENTATIVA_MS.length) - 1];
  const proximo = new Date(agora.getTime() + espera);
  return proximo.getTime() < expiraEm.getTime() ? proximo : null;
}

interface ContaEncontrada extends ContaDoPedido {
  id: string;
}

interface EnvioReservado {
  id: string;
  token: string;
  tokenHash: string;
  name: string;
  email: string;
  expiresAt: Date;
  attempts: number;
}

@Injectable()
export class PasswordResetRequests implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PasswordResetRequests');
  private rodada: Promise<void> | null = null;
  private outraRodada = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly delivery: AccountDelivery,
  ) {}

  onApplicationBootstrap(): void {
    // Retoma o que uma reinicialização interrompeu e segue a cada minuto.
    this.timer = setInterval(() => this.kick(), SWEEP_INTERVAL_MS);
    this.timer.unref();
    this.kick();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Grava o pedido e devolve; nada mais acontece dentro da requisição. */
  async enqueue(identifier: string, now = new Date()): Promise<void> {
    await this.dataSource.query(
      'INSERT INTO password_reset_requests (id, identifier, requested_at) VALUES ($1, $2, $3)',
      [generateId(), identifier, now],
    );
    setImmediate(() => this.kick());
  }

  /** Dispara uma rodada; se uma já estiver em curso, outra vem logo depois. */
  kick(): void {
    if (this.rodada) {
      this.outraRodada = true;
      return;
    }
    this.rodada = (async () => {
      do {
        this.outraRodada = false;
        await this.runOnce();
      } while (this.outraRodada);
    })()
      .catch((erro: unknown) => {
        const codigo = (erro as { code?: unknown })?.code;
        this.logger.warn(`Rodada da recuperação de senha interrompida${typeof codigo === 'string' ? ` (${codigo})` : ''}.`);
      })
      .finally(() => {
        this.rodada = null;
      });
  }

  /** Espera a rodada disparada por `enqueue` e as seguintes (testes). */
  async idle(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    while (this.rodada) await this.rodada;
  }

  async runOnce(now: () => Date = () => new Date()): Promise<{ requests: number; deliveries: number }> {
    if (!this.dataSource.isInitialized) return { requests: 0, deliveries: 0 };
    let requests = 0;
    while (requests < LOTE && (await this.processNextRequest(now()))) requests += 1;
    let deliveries = 0;
    while (deliveries < LOTE && (await this.dispatchNextDelivery(now()))) deliveries += 1;
    await this.dataSource.query(
      'DELETE FROM password_reset_requests WHERE processed_at IS NOT NULL AND processed_at < $1',
      [new Date(now().getTime() - PROCESSED_REQUEST_RETENTION_MS)],
    );
    return { requests, deliveries };
  }

  /** Resolve o pedido mais antigo ainda aberto. `false` quando não há. */
  async processNextRequest(now: Date): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const [pedido] = await manager.query<{ id: string; identifier: string }[]>(
        `SELECT id, identifier FROM password_reset_requests
          WHERE processed_at IS NULL ORDER BY requested_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!pedido) return false;
      // Ponto de salvamento: se o índice de pendente único recusar (outro
      // link nasceu no meio do caminho), o pedido termina como "link
      // preservado" em vez de travar a fila. Outro erro desfaz tudo e o
      // pedido volta na próxima rodada.
      await manager.query('SAVEPOINT resolver_pedido');
      let decisao: { outcome: RequestOutcome; resetId: string | null };
      try {
        decisao = await this.resolver(manager, pedido.identifier, now);
      } catch (erro) {
        if (!isUniqueViolation(erro, 'uq_password_resets_pending_user')) throw erro;
        await manager.query('ROLLBACK TO SAVEPOINT resolver_pedido');
        decisao = { outcome: 'ACTIVE_LINK_KEPT', resetId: null };
      }
      const { outcome, resetId } = decisao;
      await manager.query(
        `UPDATE password_reset_requests
            SET identifier = NULL, processed_at = $2, outcome = $3, password_reset_id = $4
          WHERE id = $1`,
        [pedido.id, now, outcome, resetId],
      );
      return true;
    });
  }

  private async resolver(
    manager: EntityManager,
    identifier: string,
    now: Date,
  ): Promise<{ outcome: RequestOutcome; resetId: string | null }> {
    // `citext`: a caixa não importa. A conta fica travada até o commit, então
    // dois pedidos simultâneos para ela são decididos um depois do outro (o
    // índice parcial `uq_password_resets_pending_user` é a garantia final).
    const contas = await manager.query<ContaEncontrada[]>(
      `SELECT u.id, u.status, u.email::text AS email, u.email_verified,
              EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = u.id) AS has_credential
         FROM users u
        WHERE u.email = $1 OR u.username = $1
        ORDER BY u.id LIMIT 2
        FOR UPDATE OF u`,
      [identifier],
    );
    const preliminar = decidirPedido({ contas, linkPendenteValido: false, emitidosNaUltimaHora: 0 });
    if (preliminar !== 'ISSUED') return { outcome: preliminar, resetId: null };
    const conta = contas[0];

    // Link pendente já vencido deixa de ocupar a vaga de pendente.
    await manager.query(
      `UPDATE password_resets SET status = 'EXPIRED', delivery_due_at = NULL
        WHERE user_id = $1 AND status = 'PENDING' AND expires_at <= $2`,
      [conta.id, now],
    );
    const [situacao] = await manager.query<{ pendente: boolean; emitidos: number }[]>(
      `SELECT EXISTS (SELECT 1 FROM password_resets WHERE user_id = $1 AND status = 'PENDING') AS pendente,
              (SELECT count(*)::int FROM password_resets
                WHERE user_id = $1 AND origin = 'SELF_SERVICE' AND created_at > $2) AS emitidos`,
      [conta.id, new Date(now.getTime() - HORA_MS)],
    );
    const outcome = decidirPedido({
      contas,
      linkPendenteValido: situacao.pendente,
      emitidosNaUltimaHora: situacao.emitidos,
    });
    if (outcome !== 'ISSUED') return { outcome, resetId: null };

    // O hash inicial é de um token descartado na hora: ninguém o conhece. O
    // token que vai no e-mail é emitido no envio.
    const id = generateId();
    await manager.query(
      `INSERT INTO password_resets (id, user_id, requested_by_user_id, origin, token_hash, status, created_at,
          expires_at, delivery_due_at)
       VALUES ($1, $2, NULL, 'SELF_SERVICE', $3, 'PENDING', $4, $5, $4)`,
      [id, conta.id, generateAccountToken().tokenHash, now, new Date(now.getTime() + SELF_SERVICE_LINK_TTL_MS)],
    );
    return { outcome: 'ISSUED', resetId: id };
  }

  /** Faz o envio devido mais antigo. `false` quando não há. */
  async dispatchNextDelivery(now: Date): Promise<boolean> {
    const reservado = await this.dataSource.transaction(async (manager): Promise<EnvioReservado | 'NADA' | 'DESCARTADO'> => {
      const [linha] = await manager.query<
        {
          id: string;
          status: string;
          expires_at: Date;
          delivery_attempts: number;
          name: string;
          email: string | null;
          email_verified: boolean;
          user_status: string;
          has_credential: boolean;
        }[]
      >(
        `SELECT r.id, r.status, r.expires_at, r.delivery_attempts, u.name, u.email::text AS email, u.email_verified,
                u.status AS user_status,
                EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = u.id) AS has_credential
           FROM password_resets r JOIN users u ON u.id = r.user_id
          WHERE r.delivery_due_at IS NOT NULL AND r.delivery_due_at <= $1
          ORDER BY r.delivery_due_at, r.id LIMIT 1
          FOR UPDATE OF r SKIP LOCKED`,
        [now],
      );
      if (!linha) return 'NADA';
      if (linha.status !== 'PENDING' || new Date(linha.expires_at) <= now) {
        await manager.query(
          `UPDATE password_resets
              SET delivery_due_at = NULL,
                  status = CASE WHEN status = 'PENDING' THEN 'EXPIRED' ELSE status END
            WHERE id = $1`,
          [linha.id],
        );
        return 'DESCARTADO';
      }
      // A conta mudou depois do pedido (bloqueada, e-mail trocado ou não
      // confirmado): o link é revogado e nada sai.
      const elegivel = contaElegivel({
        status: linha.user_status,
        has_credential: linha.has_credential,
        email: linha.email,
        email_verified: linha.email_verified,
      });
      if (!elegivel || linha.delivery_attempts >= MAX_DELIVERY_ATTEMPTS) {
        await manager.query(
          `UPDATE password_resets SET delivery_due_at = NULL, status = 'REVOKED', revoked_at = $2 WHERE id = $1`,
          [linha.id, now],
        );
        return 'DESCARTADO';
      }
      const { token, tokenHash } = generateAccountToken();
      await manager.query(`UPDATE password_resets SET token_hash = $2, delivery_due_at = $3 WHERE id = $1`, [
        linha.id,
        tokenHash,
        new Date(now.getTime() + DELIVERY_LEASE_MS),
      ]);
      return {
        id: linha.id,
        token,
        tokenHash,
        name: linha.name,
        email: linha.email!,
        expiresAt: new Date(linha.expires_at),
        attempts: linha.delivery_attempts,
      };
    });
    if (reservado === 'NADA') return false;
    if (reservado === 'DESCARTADO') return true;

    const resultado = await this.delivery.deliver(
      'password_resets',
      { id: reservado.id, tokenHash: reservado.tokenHash },
      emailDeRedefinicaoSolicitada(
        {
          name: reservado.name,
          email: reservado.email,
          validityMs: reservado.expiresAt.getTime() - now.getTime(),
        },
        linkDeRedefinicao(this.delivery.frontendUrl, reservado.token),
      ),
    );
    const tentativas = reservado.attempts + (resultado.status === 'NOT_CONFIGURED' ? 0 : 1);
    const proximo = proximoEnvio(resultado, tentativas, now, reservado.expiresAt);
    // Recusado em todas as tentativas: o link nunca chegou e é revogado, para
    // não segurar a vaga de pendente e permitir um pedido novo.
    const desistiu = resultado.status === 'FAILED' && proximo === null;
    await this.dataSource.query(
      `UPDATE password_resets
          SET delivery_due_at = $3,
              status = CASE WHEN $4::boolean THEN 'REVOKED' ELSE status END,
              revoked_at = CASE WHEN $4::boolean THEN $5 ELSE revoked_at END
        WHERE id = $1 AND token_hash = $2 AND status = 'PENDING'`,
      [reservado.id, reservado.tokenHash, proximo, desistiu, now],
    );
    return true;
  }
}
