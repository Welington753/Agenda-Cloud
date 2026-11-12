// Recuperação de EMERGÊNCIA do segundo fator do ÚNICO proprietário da
// plataforma que perdeu o celular e os códigos de recuperação (ver
// docs/runbooks/publicacao-2fa-administrativo.md, seção "Emergência"). Não é
// rota da API nem parte do deploy: só o operador autorizado, com a URL direta
// do banco digitada oculta, pelo lançador.
//
// O que faz, numa transação, com a conta travada:
// - confere: conta de plataforma, ativa, com e-mail; e NENHUM outro
//   MASTER_OWNER ativo com fator (havendo, a recuperação é pelo portal, por
//   outro proprietário, e o script recusa);
// - revoga liberações anteriores e encerra todas as sessões da conta;
// - grava uma liberação de uso único (60 min), só o hash do token, com
//   `via = 'SCRIPT'`, e o registro de auditoria (ator = a própria conta, que é
//   quem opera; resumo e `newData` dizem que foi por script).
// NÃO remove o fator ativo, NÃO cria sessão, NÃO dá acesso: a pessoa entra
// com a senha, usa a liberação e cadastra um novo autenticador. O token só
// existe no retorno desta função (o terminal mostra uma vez).
import { createHash, randomBytes } from "node:crypto";

export const VALIDADE_DA_LIBERACAO_MS = 60 * 60 * 1000;
const ID = () => randomBytes(15).toString("hex").slice(0, 25);

export class RecusaDaLiberacao extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/**
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} cliente
 * @param {{ email: string; motivo: string; agora?: Date }} pedido
 */
export async function emitirLiberacaoDeEmergencia(cliente, { email, motivo, agora = new Date() }) {
  const motivoLimpo = String(motivo ?? "").trim();
  if (motivoLimpo.length < 10 || motivoLimpo.length > 300) {
    throw new RecusaDaLiberacao("MOTIVO", "Informe o motivo (10 a 300 caracteres).");
  }
  await cliente.query("BEGIN");
  try {
    const { rows: contas } = await cliente.query(
      `SELECT id, name, status::text AS status, platform_role::text AS platform_role
         FROM users WHERE lower(email::text) = lower($1) FOR UPDATE`,
      [email],
    );
    if (contas.length !== 1) throw new RecusaDaLiberacao("CONTA", "Nenhuma conta (ou mais de uma) com este e-mail.");
    const conta = contas[0];
    if (!conta.platform_role) throw new RecusaDaLiberacao("PAPEL", "A conta não é da administração da plataforma.");
    if (conta.status !== "ACTIVE") throw new RecusaDaLiberacao("INATIVA", "A conta não está ativa.");
    const { rows: outros } = await cliente.query(
      `SELECT count(*)::int AS total FROM users u
        WHERE u.platform_role = 'MASTER_OWNER' AND u.status = 'ACTIVE' AND u.id <> $1
          AND EXISTS (SELECT 1 FROM user_second_factors f WHERE f.user_id = u.id)`,
      [conta.id],
    );
    if (outros[0].total > 0) {
      throw new RecusaDaLiberacao(
        "HA_OUTRO_PROPRIETARIO",
        "Há outro proprietário ativo com verificação em duas etapas: a recuperação é pelo portal, por ele.",
      );
    }
    await cliente.query(
      `UPDATE second_factor_grants SET revoked_at = $2 WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
      [conta.id, agora],
    );
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const grantId = ID();
    const expiraEm = new Date(agora.getTime() + VALIDADE_DA_LIBERACAO_MS);
    await cliente.query(
      `INSERT INTO second_factor_grants (id, user_id, token_hash, issued_by_user_id, via, reason, created_at, expires_at, delivery_status)
       VALUES ($1, $2, $3, $2, 'SCRIPT', $4, $5, $6, 'NOT_CONFIGURED')`,
      [grantId, conta.id, tokenHash, motivoLimpo, agora, expiraEm],
    );
    const { rows: encerradas } = await cliente.query(
      `UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
      [conta.id, agora],
    );
    await cliente.query(
      `INSERT INTO audit_logs (id, occurred_at, action, actor_user_id, actor_name, target_user_id, summary, new_data)
       VALUES ($1, $2, 'SECOND_FACTOR_GRANT_ISSUED'::audit_action, $3, $4, $3, $5, $6::jsonb)`,
      [
        ID(),
        agora,
        conta.id,
        conta.name,
        "Liberação de EMERGÊNCIA do segundo fator emitida por script de operação (único proprietário sem celular e sem códigos). Sessões encerradas.",
        JSON.stringify({ grantId, via: "SCRIPT", reason: motivoLimpo, expiresAt: expiraEm.toISOString(), sessionsRevoked: encerradas.length }),
      ],
    );
    await cliente.query("COMMIT");
    return { token, grantId, userId: conta.id, expiraEm };
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  }
}

/** Caminho para colar depois do endereço do portal. O token vai no fragmento. */
export function caminhoDaLiberacao(token) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("token em formato inválido");
  return `/portal/liberacao-2fa#t=${token}`;
}
