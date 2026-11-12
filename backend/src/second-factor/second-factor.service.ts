// Segundo fator (TOTP) das contas de plataforma: estado, verificação,
// recuperação, cadastro, confirmação, novos códigos e liberações (ver
// docs/plans/2fa-contas-administrativas.md).
//
// Regras que valem para todas as operações:
// - toda tentativa de código passa pela trava por conta
//   (`second_factor_attempts`, linha travada com FOR UPDATE): cinco falhas em
//   15 minutos travam as tentativas de segundo fator por 15 minutos, e uma
//   tentativa durante a trava é recusada SEM contar (não prolonga). A falha é
//   gravada (COMMIT) antes da resposta de erro;
// - um código TOTP só é aceito se o contador dele for MAIOR que o último
//   aceito (`last_used_counter`, com a linha do fator travada): o mesmo
//   código nunca vale duas vezes, nem em requisições simultâneas;
// - um código de recuperação é consumido por UPDATE condicional
//   (`used_at IS NULL`): só uma requisição o consome;
// - segredo, URI, QR, código e token nunca vão para log, auditoria ou outra
//   resposta. A auditoria registra só a ação, a conta e o método;
// - falha ao decifrar o segredo responde "indisponível" e NUNCA libera nada;
// - o fator ativo só é substituído quando um código do NOVO fator é
//   confirmado. Recuperação pedida não remove o fator.
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { toString as qrCodeToString } from 'qrcode';
import { DataSource, type EntityManager } from 'typeorm';
import { AccountDelivery } from '../accounts/account-delivery.js';
import {
  emailDeAvisoDeSeguranca,
  emailDeLiberacaoDoSegundoFator,
  linkDaSegurancaDoPortal,
  linkDeLiberacaoDoSegundoFator,
  type AvisoDeSeguranca,
} from '../accounts/account-emails.js';
import { generateAccountToken, hashAccountToken, isValidAccountTokenFormat } from '../accounts/account-token.js';
import { assertCanManageAccount, loadActor, requireCapability } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { requireRecentReauth } from '../accounts/reauth.js';
import { linhasDe } from '../common/linhas-de.js';
import { generateId } from '../entities/common/generate-id.js';
import { SecondFactorConfig } from './second-factor-config.js';
import { loadSessionSecondFactor, type SessionSecondFactor } from './second-factor-facts.js';
import { recusaDoSegundoFator } from './second-factor.guard.js';
import {
  afterFailure,
  ENROLLMENT_PERMISSION_MS,
  ENROLLMENT_TTL_MS,
  GRANT_TTL_MS,
  lockedUntil,
  recentlyVerified,
  type AttemptRow,
} from './second-factor-state.js';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes.js';
import { openSecret, sealSecret, SecretUnavailableError, type SealedSecret } from './secret-cipher.js';
import { manualKey, matchTotpCounter, newTotpSecret, otpauthUri } from './totp.js';

export const CODIGO_INVALIDO = 'CODIGO_INVALIDO';
export const SEGUNDO_FATOR_BLOQUEADO = 'SEGUNDO_FATOR_BLOQUEADO';
export const SEGUNDO_FATOR_INDISPONIVEL = 'SEGUNDO_FATOR_INDISPONIVEL';

const conflito = (code: string, message: string) => new ConflictException({ code, message });
const proibido = (code: string, message: string) => new ForbiddenException({ code, message });

function codigoInvalido(): BadRequestException {
  return new BadRequestException({ code: CODIGO_INVALIDO, message: 'Código incorreto ou expirado.' });
}

function bloqueado(ate: Date, now: Date): HttpException {
  return new HttpException(
    {
      code: SEGUNDO_FATOR_BLOQUEADO,
      message: 'Muitas tentativas de código. Aguarde para tentar de novo.',
      retryAfterSeconds: Math.max(1, Math.ceil((ate.getTime() - now.getTime()) / 1000)),
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

function indisponivel(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: SEGUNDO_FATOR_INDISPONIVEL,
    message: 'A verificação pelo aplicativo autenticador está indisponível agora. Use um código de recuperação.',
  });
}

type Tentativa =
  | { ok: true }
  | { ok: false; motivo: 'bloqueado'; ate: Date }
  | { ok: false; motivo: 'invalido'; travou: boolean }
  | { ok: false; motivo: 'indisponivel' };

type Confirmacao =
  | { tipo: 'ok'; codigos: string[]; substituiu: boolean }
  | { tipo: 'expirado' }
  | { tipo: 'falha'; tentativa: Tentativa };

interface FatorRow {
  secret_ciphertext: Buffer;
  secret_nonce: Buffer;
  secret_tag: Buffer;
  key_version: number;
  last_used_counter: string | number | null;
}

const selado = (r: FatorRow): SealedSecret => ({
  ciphertext: r.secret_ciphertext,
  nonce: r.secret_nonce,
  tag: r.secret_tag,
  keyVersion: Number(r.key_version),
});

export interface SecondFactorView {
  state: string;
  enrollmentPermitted: boolean;
  recoveryPending: boolean;
  verifiedUntil: string | null;
  factor: { method: 'TOTP'; confirmedAt: string; remainingRecoveryCodes: number } | null;
  locked: { until: string } | null;
  available: boolean;
}

@Injectable()
export class SecondFactorService {
  private readonly logger = new Logger('SecondFactor');

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: SecondFactorConfig,
    private readonly delivery: AccountDelivery,
  ) {}

  // ------------------------------------------------------------- leitura

  async status(userId: string, sessionId: string, now = new Date()): Promise<SecondFactorView> {
    const manager = this.dataSource.manager;
    const sessao = await this.sessao(manager, userId, sessionId, now);
    const [fator] = await manager.query<{ confirmed_at: Date; restantes: number }[]>(
      `SELECT f.confirmed_at,
              (SELECT count(*)::int FROM second_factor_recovery_codes c WHERE c.user_id = f.user_id AND c.used_at IS NULL) AS restantes
         FROM user_second_factors f WHERE f.user_id = $1`,
      [userId],
    );
    const [tent] = await manager.query<{ locked_until: Date | null }[]>(
      `SELECT locked_until FROM second_factor_attempts WHERE user_id = $1`,
      [userId],
    );
    const trava = tent?.locked_until && tent.locked_until > now ? tent.locked_until : null;
    return {
      state: sessao.status.state,
      enrollmentPermitted: sessao.status.enrollmentPermitted,
      recoveryPending: sessao.status.recoveryPending,
      verifiedUntil: sessao.status.verifiedUntil?.toISOString() ?? null,
      factor: fator
        ? { method: 'TOTP', confirmedAt: new Date(fator.confirmed_at).toISOString(), remainingRecoveryCodes: fator.restantes }
        : null,
      locked: trava ? { until: trava.toISOString() } : null,
      available: this.config.keyring !== null,
    };
  }

  // ---------------------------------------------------------- verificação

  /** Código do aplicativo: marca ESTA sessão como verificada (12 horas). */
  async verify(userId: string, sessionId: string, code: string, now = new Date()): Promise<SecondFactorView> {
    const resultado = await this.dataSource.transaction(async (manager) => {
      const sessao = await this.sessao(manager, userId, sessionId, now);
      if (!sessao.facts.hasPlatformRole) throw this.naoAplicavel();
      if (!sessao.facts.factorActive) {
        throw conflito('SEGUNDO_FATOR_INEXISTENTE', 'Esta conta ainda não tem a verificação em duas etapas cadastrada.');
      }
      const tentativa = await this.tentarTotp(manager, userId, code, now);
      if (tentativa.ok) await this.marcarSessao(manager, sessionId, 'TOTP', now);
      return tentativa;
    });
    await this.depoisDaTentativa(userId, resultado, now);
    return this.status(userId, sessionId, now);
  }

  /** Código de recuperação: vale uma vez e verifica ESTA sessão. */
  async recover(userId: string, sessionId: string, code: string, now = new Date()): Promise<SecondFactorView> {
    const resultado = await this.dataSource.transaction(async (manager) => {
      const sessao = await this.sessao(manager, userId, sessionId, now);
      if (!sessao.facts.hasPlatformRole) throw this.naoAplicavel();
      if (!sessao.facts.factorActive) {
        throw conflito('SEGUNDO_FATOR_INEXISTENTE', 'Esta conta ainda não tem a verificação em duas etapas cadastrada.');
      }
      const tentativa = await this.tentarRecuperacao(manager, userId, code, now);
      if (tentativa.ok) {
        await this.marcarSessao(manager, sessionId, 'RECOVERY_CODE', now);
        await recordAudit(
          manager,
          {
            action: 'RECOVERY_CODE_USED',
            actor: { id: userId, name: sessao.name },
            targetUserId: userId,
            summary: 'Código de recuperação usado para confirmar a verificação em duas etapas.',
          },
          now,
        );
      }
      return tentativa;
    });
    await this.depoisDaTentativa(userId, resultado, now);
    if (resultado.ok) await this.avisar(userId, 'RECOVERY_CODE_USED');
    return this.status(userId, sessionId, now);
  }

  // ---------------------------------------------------------- liberações

  /** Usa uma liberação recebida por e-mail: permite que ESTA sessão (da
   * mesma conta, já autenticada pela senha) cadastre um fator por 30 min.
   * Não dá acesso ao portal nem remove o fator ativo. */
  async redeemGrant(userId: string, sessionId: string, token: string, now = new Date()): Promise<SecondFactorView> {
    if (!isValidAccountTokenFormat(token)) throw this.liberacaoInvalida();
    await this.dataSource.transaction(async (manager) => {
      const sessao = await this.sessao(manager, userId, sessionId, now);
      if (!sessao.facts.hasPlatformRole || !sessao.userActive) throw this.liberacaoInvalida();
      const [usada] = linhasDe<{ id: string }>(
        await manager.query(
        `UPDATE second_factor_grants SET used_at = $3
          WHERE token_hash = $1 AND user_id = $2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > $3
        RETURNING id`,
        [hashAccountToken(token), userId, now],
        ),
      );
      // Inválida, de outra conta, usada, revogada ou vencida: a mesma resposta.
      if (!usada) throw this.liberacaoInvalida();
      await manager.query(
        `UPDATE sessions SET second_factor_enrollment_allowed_until = $2 WHERE id = $1`,
        [sessionId, new Date(now.getTime() + ENROLLMENT_PERMISSION_MS)],
      );
      await recordAudit(
        manager,
        {
          action: 'SECOND_FACTOR_GRANT_USED',
          actor: { id: userId, name: sessao.name },
          targetUserId: userId,
          summary: 'Liberação de cadastro da verificação em duas etapas usada pelo titular.',
          newData: { grantId: usada.id },
        },
        now,
      );
    });
    return this.status(userId, sessionId, now);
  }

  /**
   * Outro proprietário da plataforma emite uma liberação para `targetId`
   * (recuperação ou primeiro cadastro de quem foi promovido). Exige, NESTA
   * sessão, senha confirmada há pouco e segundo fator confirmado há pouco,
   * motivo e e-mail verificado do titular. Encerra as sessões do titular e
   * revoga liberações anteriores. NÃO remove o fator ativo. O link vai só ao
   * e-mail do titular; a resposta nunca o contém.
   */
  async issueGrant(
    actorId: string,
    actorSessionId: string,
    targetId: string,
    dto: { reason: string; requestKey: string },
    now = new Date(),
  ) {
    const repetido = await this.grantPorChave(actorId, dto.requestKey);
    if (repetido) return repetido;
    const emitida = await this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, actorSessionId, now);
      // A permissão vem antes de qualquer outra recusa: quem não pode emitir
      // recebe o mesmo 403 de sempre.
      const actor = await loadActor(manager, actorId, true);
      requireCapability(actor, 'managePlatformAccess');
      const sessaoDoAtor = await this.sessao(manager, actorId, actorSessionId, now);
      if (!recentlyVerified(sessaoDoAtor.verifiedAt, now)) {
        throw proibido('SEGUNDO_FATOR_RECENTE_NECESSARIO', 'Confirme o código do seu aplicativo autenticador para continuar.');
      }
      const [alvo] = await manager.query<
        { id: string; name: string; email: string | null; email_verified: boolean; status: string; platform_role: string | null }[]
      >(
        `SELECT id, name, email::text AS email, email_verified, status::text AS status, platform_role::text AS platform_role
           FROM users WHERE id = $1 FOR UPDATE`,
        [targetId],
      );
      if (!alvo) throw proibido('CONTA_INEXISTENTE', 'Conta não encontrada.');
      assertCanManageAccount(actor, { id: alvo.id, platformRole: alvo.platform_role as never });
      if (!alvo.platform_role) {
        throw conflito('SEGUNDO_FATOR_NAO_APLICAVEL', 'Só contas da administração da plataforma usam esta liberação.');
      }
      if (alvo.status !== 'ACTIVE') throw conflito('CONTA_INATIVA', 'A conta não está ativa.');
      if (!alvo.email || !alvo.email_verified) {
        throw conflito('LIBERACAO_SEM_EMAIL_VERIFICADO', 'A conta não tem e-mail verificado para receber a liberação.');
      }
      // Sem envio de e-mail configurado, nada é criado: o link nunca é mostrado
      // a quem emite (a recuperação do único proprietário é pelo script).
      if (!this.delivery.sender.configured) {
        throw conflito('LIBERACAO_SEM_EMAIL', 'O envio de e-mail não está configurado neste servidor. Nenhuma liberação foi criada.');
      }
      await manager.query(
        `UPDATE second_factor_grants SET revoked_at = $2 WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [alvo.id, now],
      );
      const { token, tokenHash } = generateAccountToken();
      const grantId = generateId();
      const expiresAt = new Date(now.getTime() + GRANT_TTL_MS);
      await manager.query(
        `INSERT INTO second_factor_grants (id, user_id, token_hash, issued_by_user_id, via, reason, request_key, created_at, expires_at)
         VALUES ($1, $2, $3, $4, 'PORTAL', $5, $6, $7, $8)`,
        [grantId, alvo.id, tokenHash, actor.id, dto.reason, dto.requestKey, now, expiresAt],
      );
      const encerradas = await manager.query<{ id: string }[]>(
        `UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
        [alvo.id, now],
      );
      await recordAudit(
        manager,
        {
          action: 'SECOND_FACTOR_GRANT_ISSUED',
          actor,
          targetUserId: alvo.id,
          summary: `Liberação de cadastro da verificação em duas etapas enviada ao e-mail de ${alvo.email}. Sessões da conta encerradas.`,
          newData: { grantId, via: 'PORTAL', reason: dto.reason, expiresAt: expiresAt.toISOString(), sessionsRevoked: linhasDe(encerradas).length },
        },
        now,
      );
      return { grantId, token, tokenHash, expiresAt, pessoa: { name: alvo.name, email: alvo.email } };
    });
    const mensagem = emailDeLiberacaoDoSegundoFator(
      emitida.pessoa,
      linkDeLiberacaoDoSegundoFator(this.delivery.frontendUrl, emitida.token),
      GRANT_TTL_MS,
    );
    const envio = await this.delivery.deliver('second_factor_grants', { id: emitida.grantId, tokenHash: emitida.tokenHash }, mensagem);
    return { created: true, grantId: emitida.grantId, expiresAt: emitida.expiresAt.toISOString(), delivery: { status: envio.status } };
  }

  // ------------------------------------------------------------- cadastro

  /**
   * Começa o cadastro de um fator (primeiro ou troca). Exige senha confirmada
   * há pouco NESTA sessão e uma destas autorizações:
   * - a sessão pode cadastrar (convite de plataforma aceito ou liberação
   *   usada nela, dentro do prazo);
   * - conta sem fator na fase opcional e não marcada como master novo;
   * - conta com fator, sessão verificada E um código atual (do aplicativo ou
   *   de recuperação) nesta chamada.
   * Devolve o segredo UMA vez (URI, QR e chave manual). Nada é ativado aqui.
   */
  async startEnrollment(userId: string, sessionId: string, code: string | undefined, now = new Date()) {
    const keyring = this.config.keyring;
    if (!keyring) throw indisponivel();
    const inicial = await this.sessao(this.dataSource.manager, userId, sessionId, now);
    if (!inicial.facts.hasPlatformRole || !inicial.userActive) throw this.naoAplicavel();
    await requireRecentReauth(this.dataSource.manager, sessionId, now);

    const st = inicial.status;
    if (!st.enrollmentPermitted) {
      if (st.state === 'VERIFIED') {
        if (code === undefined) {
          throw proibido('SEGUNDO_FATOR_CODIGO_NECESSARIO', 'Digite um código atual para trocar o aplicativo autenticador.');
        }
        const resultado = await this.dataSource.transaction(async (manager) => {
          const tentativa = await this.tentarTotp(manager, userId, code, now, { semIndisponivel: true });
          return tentativa.ok || tentativa.motivo === 'bloqueado' ? tentativa : this.tentarRecuperacao(manager, userId, code, now, { jaContou: tentativa });
        });
        await this.depoisDaTentativa(userId, resultado, now);
      } else if (st.state === 'ENROLLMENT_REQUIRED') {
        throw proibido(
          'SEGUNDO_FATOR_LIBERACAO_NECESSARIA',
          'Para cadastrar, use o link de liberação enviado ao seu e-mail ou o convite da administração.',
        );
      } else if (st.state === 'VERIFICATION_REQUIRED') {
        throw recusaDoSegundoFator(st);
      }
      // ENROLLMENT_OPTIONAL: segue.
    }

    const segredo = newTotpSecret();
    const lacrado = sealSecret(segredo, userId, keyring);
    const expiresAt = new Date(now.getTime() + ENROLLMENT_TTL_MS);
    await this.dataSource.transaction(async (manager) => {
      // Relido com a conta travada: papel retirado ou sessão encerrada no meio
      // do caminho valem aqui.
      await manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const sessao = await this.sessao(manager, userId, sessionId, now);
      if (!sessao.facts.hasPlatformRole) throw this.naoAplicavel();
      await manager.query('DELETE FROM second_factor_enrollments WHERE user_id = $1', [userId]);
      await manager.query(
        `INSERT INTO second_factor_enrollments
           (id, user_id, session_id, secret_ciphertext, secret_nonce, secret_tag, key_version, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [generateId(), userId, sessionId, lacrado.ciphertext, lacrado.nonce, lacrado.tag, lacrado.keyVersion, now, expiresAt],
      );
    });
    const rotulo = inicial.email ?? inicial.name;
    const uri = otpauthUri(segredo, rotulo);
    return {
      otpauthUri: uri,
      qrSvg: await qrCodeToString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }),
      manualKey: manualKey(segredo),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Confirma o cadastro com um código do NOVO segredo. Só aqui o fator vira
   * ativo (substituindo o anterior, se houver). Na mesma transação: novos
   * códigos de recuperação (os antigos deixam de valer), liberações
   * pendentes revogadas, esta sessão verificada e as OUTRAS sessões da conta
   * encerradas. Devolve os códigos de recuperação UMA vez.
   */
  async confirmEnrollment(userId: string, sessionId: string, code: string, now = new Date()) {
    const keyring = this.config.keyring;
    const resultado = await this.dataSource.transaction(async (manager): Promise<Confirmacao> => {
      const sessao = await this.sessao(manager, userId, sessionId, now);
      if (!sessao.facts.hasPlatformRole) throw this.naoAplicavel();
      const trava = await this.portao(manager, userId, now);
      if (trava) return { tipo: 'falha', tentativa: { ok: false, motivo: 'bloqueado', ate: trava } };
      const [pendente] = await manager.query<(FatorRow & { id: string; session_id: string; expires_at: Date })[]>(
        `SELECT id, session_id, secret_ciphertext, secret_nonce, secret_tag, key_version, expires_at, NULL AS last_used_counter
           FROM second_factor_enrollments WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );
      if (!pendente || pendente.session_id !== sessionId) {
        throw conflito('CADASTRO_INEXISTENTE', 'Nenhum cadastro em andamento nesta sessão. Comece de novo.');
      }
      if (pendente.expires_at <= now) {
        await manager.query('DELETE FROM second_factor_enrollments WHERE id = $1', [pendente.id]);
        return { tipo: 'expirado' };
      }
      let segredo: Buffer;
      try {
        segredo = openSecret(selado(pendente), userId, keyring);
      } catch (erro) {
        if (erro instanceof SecretUnavailableError) return { tipo: 'falha', tentativa: { ok: false, motivo: 'indisponivel' } };
        throw erro;
      }
      const contador = matchTotpCounter(segredo, code, now.getTime());
      if (contador === null) return { tipo: 'falha', tentativa: await this.falhar(manager, userId, now) };

      const [anterior] = await manager.query<{ user_id: string }[]>(
        'SELECT user_id FROM user_second_factors WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      await manager.query(
        `INSERT INTO user_second_factors
           (user_id, method, secret_ciphertext, secret_nonce, secret_tag, key_version, confirmed_at, last_used_counter, created_at, updated_at)
         VALUES ($1, 'TOTP', $2, $3, $4, $5, $6, $7, $6, $6)
         ON CONFLICT (user_id) DO UPDATE SET
           secret_ciphertext = EXCLUDED.secret_ciphertext, secret_nonce = EXCLUDED.secret_nonce,
           secret_tag = EXCLUDED.secret_tag, key_version = EXCLUDED.key_version,
           confirmed_at = EXCLUDED.confirmed_at, last_used_counter = EXCLUDED.last_used_counter, updated_at = EXCLUDED.updated_at`,
        [userId, pendente.secret_ciphertext, pendente.secret_nonce, pendente.secret_tag, pendente.key_version, now, contador],
      );
      const codigos = await this.novosCodigos(manager, userId, now);
      await manager.query('DELETE FROM second_factor_enrollments WHERE id = $1', [pendente.id]);
      await manager.query(
        `UPDATE second_factor_grants SET revoked_at = $2 WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [userId, now],
      );
      await manager.query(
        `UPDATE users SET second_factor_enrollment_required = false WHERE id = $1 AND second_factor_enrollment_required`,
        [userId],
      );
      await this.marcarSessao(manager, sessionId, 'TOTP', now);
      await this.encerrarOutrasSessoes(manager, userId, sessionId, now);
      await this.zerarTentativas(manager, userId);
      await recordAudit(
        manager,
        {
          action: anterior ? 'SECOND_FACTOR_REPLACED' : 'SECOND_FACTOR_ENABLED',
          actor: { id: userId, name: sessao.name },
          targetUserId: userId,
          summary: anterior
            ? 'Aplicativo autenticador trocado. Novos códigos de recuperação; outras sessões encerradas.'
            : 'Verificação em duas etapas ativada. Códigos de recuperação gerados; outras sessões encerradas.',
          newData: { method: 'TOTP', recoveryCodes: codigos.length },
        },
        now,
      );
      return { tipo: 'ok', codigos, substituiu: !!anterior };
    });
    if (resultado.tipo === 'ok') {
      await this.avisar(userId, resultado.substituiu ? 'SECOND_FACTOR_REPLACED' : 'SECOND_FACTOR_ENABLED');
      return { recoveryCodes: resultado.codigos, status: await this.status(userId, sessionId, now) };
    }
    if (resultado.tipo === 'expirado') {
      throw new GoneException({ code: 'CADASTRO_EXPIRADO', message: 'O cadastro expirou. Comece de novo.' });
    }
    await this.depoisDaTentativa(userId, resultado.tentativa, now);
    throw codigoInvalido();
  }

  /** Novos códigos de recuperação (os anteriores deixam de valer). Exige
   * sessão verificada, senha confirmada há pouco e um código atual do
   * aplicativo. Encerra as outras sessões. */
  async regenerateRecoveryCodes(userId: string, sessionId: string, code: string, now = new Date()) {
    const inicial = await this.sessao(this.dataSource.manager, userId, sessionId, now);
    if (!inicial.facts.hasPlatformRole) throw this.naoAplicavel();
    if (inicial.status.state !== 'VERIFIED') throw recusaDoSegundoFator(inicial.status);
    await requireRecentReauth(this.dataSource.manager, sessionId, now);
    const resultado = await this.dataSource.transaction(async (manager) => {
      const tentativa = await this.tentarTotp(manager, userId, code, now);
      if (!tentativa.ok) return { tentativa };
      const codigos = await this.novosCodigos(manager, userId, now);
      await this.encerrarOutrasSessoes(manager, userId, sessionId, now);
      await recordAudit(
        manager,
        {
          action: 'RECOVERY_CODES_REGENERATED',
          actor: { id: userId, name: inicial.name },
          targetUserId: userId,
          summary: 'Novos códigos de recuperação gerados; os anteriores não valem mais. Outras sessões encerradas.',
          newData: { recoveryCodes: codigos.length },
        },
        now,
      );
      return { tentativa, codigos };
    });
    await this.depoisDaTentativa(userId, resultado.tentativa, now);
    await this.avisar(userId, 'RECOVERY_CODES_REGENERATED');
    return { recoveryCodes: resultado.codigos!, status: await this.status(userId, sessionId, now) };
  }

  // ------------------------------------------------------------ internos

  private async sessao(manager: EntityManager, userId: string, sessionId: string, now: Date): Promise<SessionSecondFactor> {
    const sessao = await loadSessionSecondFactor(manager, userId, sessionId, this.config.enforcement, now);
    if (!sessao) throw new UnauthorizedException('Não autenticado.');
    return sessao;
  }

  private naoAplicavel(): ForbiddenException {
    return proibido('SEGUNDO_FATOR_NAO_APLICAVEL', 'A verificação em duas etapas é só das contas da administração da plataforma.');
  }

  private liberacaoInvalida(): GoneException {
    return new GoneException({ code: 'LIBERACAO_INVALIDA', message: 'Link de liberação inválido, já usado ou vencido.' });
  }

  /** Trava a linha de tentativas da conta e diz se as tentativas estão
   * bloqueadas. Serializa todas as tentativas de código da mesma conta. */
  private async portao(manager: EntityManager, userId: string, now: Date): Promise<Date | null> {
    await manager.query(`INSERT INTO second_factor_attempts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
    const row = await this.linhaDeTentativas(manager, userId);
    return lockedUntil(row, now);
  }

  private async linhaDeTentativas(manager: EntityManager, userId: string): Promise<AttemptRow | null> {
    const [r] = await manager.query<{ failed_count: number; window_started_at: Date | null; locked_until: Date | null }[]>(
      `SELECT failed_count, window_started_at, locked_until FROM second_factor_attempts WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    return r ? { failedCount: r.failed_count, windowStartedAt: r.window_started_at, lockedUntil: r.locked_until } : null;
  }

  private async falhar(manager: EntityManager, userId: string, now: Date): Promise<Tentativa> {
    const prox = afterFailure(await this.linhaDeTentativas(manager, userId), now);
    await manager.query(
      `UPDATE second_factor_attempts SET failed_count = $2, window_started_at = $3, locked_until = $4 WHERE user_id = $1`,
      [userId, prox.failedCount, prox.windowStartedAt, prox.lockedUntil],
    );
    if (prox.lockedNow) {
      const [u] = await manager.query<{ name: string }[]>('SELECT name FROM users WHERE id = $1', [userId]);
      await recordAudit(
        manager,
        {
          action: 'SECOND_FACTOR_LOCKED',
          actor: { id: userId, name: u?.name ?? '' },
          targetUserId: userId,
          summary: 'Tentativas de verificação em duas etapas bloqueadas por 15 minutos após várias falhas.',
        },
        now,
      );
    }
    return { ok: false, motivo: 'invalido', travou: prox.lockedNow };
  }

  private async zerarTentativas(manager: EntityManager, userId: string): Promise<void> {
    await manager.query(
      `UPDATE second_factor_attempts SET failed_count = 0, window_started_at = NULL, locked_until = NULL WHERE user_id = $1`,
      [userId],
    );
  }

  /** Código do aplicativo contra o fator ATIVO, com trava e sem reutilização. */
  private async tentarTotp(
    manager: EntityManager,
    userId: string,
    code: string,
    now: Date,
    opcoes: { semIndisponivel?: boolean } = {},
  ): Promise<Tentativa> {
    const trava = await this.portao(manager, userId, now);
    if (trava) return { ok: false, motivo: 'bloqueado', ate: trava };
    const [fator] = await manager.query<FatorRow[]>(
      `SELECT secret_ciphertext, secret_nonce, secret_tag, key_version, last_used_counter
         FROM user_second_factors WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (!fator) return this.falhar(manager, userId, now);
    let segredo: Buffer;
    try {
      segredo = openSecret(selado(fator), userId, this.config.keyring);
    } catch (erro) {
      if (!(erro instanceof SecretUnavailableError)) throw erro;
      // Sem chave: nunca aceita. Na troca, ainda dá para usar um código de
      // recuperação (quem chama tenta em seguida).
      return opcoes.semIndisponivel ? { ok: false, motivo: 'invalido', travou: false } : { ok: false, motivo: 'indisponivel' };
    }
    const contador = matchTotpCounter(segredo, code, now.getTime());
    const ultimo = fator.last_used_counter === null ? null : Number(fator.last_used_counter);
    if (contador === null || (ultimo !== null && contador <= ultimo)) {
      // Na troca, um texto que não é TOTP pode ser código de recuperação: a
      // falha só conta depois de tentar os dois.
      if (opcoes.semIndisponivel) return { ok: false, motivo: 'invalido', travou: false };
      return this.falhar(manager, userId, now);
    }
    await manager.query(
      `UPDATE user_second_factors SET last_used_counter = $2, updated_at = $3 WHERE user_id = $1`,
      [userId, contador, now],
    );
    await this.zerarTentativas(manager, userId);
    return { ok: true };
  }

  /** Código de recuperação: consumo atômico (só uma requisição o usa). */
  private async tentarRecuperacao(
    manager: EntityManager,
    userId: string,
    code: string,
    now: Date,
    opcoes: { jaContou?: Tentativa } = {},
  ): Promise<Tentativa> {
    if (!opcoes.jaContou) {
      const trava = await this.portao(manager, userId, now);
      if (trava) return { ok: false, motivo: 'bloqueado', ate: trava };
    }
    const normalizado = normalizeRecoveryCode(code);
    const usados = normalizado
      ? await manager.query<{ id: string }[]>(
          `UPDATE second_factor_recovery_codes SET used_at = $3
            WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
          RETURNING id`,
          [userId, hashRecoveryCode(normalizado), now],
        )
      : [];
    if (linhasDe(usados).length === 0) return this.falhar(manager, userId, now);
    await this.zerarTentativas(manager, userId);
    return { ok: true };
  }

  /** Depois do COMMIT da tentativa: aviso de trava e a resposta de erro. */
  private async depoisDaTentativa(userId: string, tentativa: Tentativa, now: Date): Promise<void> {
    if (tentativa.ok) return;
    if (tentativa.motivo === 'bloqueado') throw bloqueado(tentativa.ate, now);
    if (tentativa.motivo === 'indisponivel') throw indisponivel();
    if (tentativa.travou) await this.avisar(userId, 'SECOND_FACTOR_LOCKED');
    throw codigoInvalido();
  }

  private async marcarSessao(manager: EntityManager, sessionId: string, metodo: 'TOTP' | 'RECOVERY_CODE', now: Date) {
    await manager.query(
      `UPDATE sessions SET second_factor_verified_at = $2, second_factor_method = $3 WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, now, metodo],
    );
  }

  private async encerrarOutrasSessoes(manager: EntityManager, userId: string, sessionId: string, now: Date) {
    await manager.query(
      `UPDATE sessions SET revoked_at = $3 WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [userId, sessionId, now],
    );
  }

  private async novosCodigos(manager: EntityManager, userId: string, now: Date): Promise<string[]> {
    const { codes, hashes } = generateRecoveryCodes();
    await manager.query('DELETE FROM second_factor_recovery_codes WHERE user_id = $1', [userId]);
    for (const hash of hashes) {
      await manager.query(
        `INSERT INTO second_factor_recovery_codes (id, user_id, code_hash, created_at) VALUES ($1, $2, $3, $4)`,
        [generateId(), userId, hash, now],
      );
    }
    return codes;
  }

  private async grantPorChave(actorId: string, requestKey: string) {
    const [g] = await this.dataSource.manager.query<{ id: string; expires_at: Date; delivery_status: string }[]>(
      `SELECT id, expires_at, delivery_status FROM second_factor_grants WHERE issued_by_user_id = $1 AND request_key = $2`,
      [actorId, requestKey],
    );
    return g
      ? { created: false, grantId: g.id, expiresAt: new Date(g.expires_at).toISOString(), delivery: { status: g.delivery_status } }
      : null;
  }

  /** Aviso por e-mail ao titular, depois do COMMIT. Melhor esforço: sem
   * e-mail configurado ou verificado, não envia (a auditoria é o registro). */
  private async avisar(userId: string, aviso: AvisoDeSeguranca): Promise<void> {
    try {
      const [u] = await this.dataSource.manager.query<{ name: string; email: string | null; email_verified: boolean }[]>(
        `SELECT name, email::text AS email, email_verified FROM users WHERE id = $1`,
        [userId],
      );
      if (!u?.email || !u.email_verified) return;
      await this.delivery.sender.send(
        emailDeAvisoDeSeguranca({ name: u.name, email: u.email }, aviso, linkDaSegurancaDoPortal(this.delivery.frontendUrl)),
      );
    } catch {
      this.logger.warn(`Aviso de segurança não enviado (${aviso}).`);
    }
  }
}

