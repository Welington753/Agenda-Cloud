// Contas de teste SEM cadastro público (que foi fechado): a fixture grava no
// PostgreSQL DESCARTÁVEL um estabelecimento com a unidade principal, a conta
// pendente do responsável e um convite com token conhecido, e ativa a conta
// pelo fluxo REAL (`POST /invites/accept`). É o mesmo caminho de quem recebe
// o convite por e-mail: senha com a política e o Argon2id do backend, vínculo
// de DONO e sessão em cookie HttpOnly no `APIRequestContext` usado (o do
// navegador divide os cookies com a página).
//
// Só conecta a banco local (127.0.0.1/localhost) com TLS verificado; nunca a
// Neon, piloto, production ou `agenda_dev`. Cada conta tem nomes próprios e
// nada de outro teste é apagado. O convite vale 7 dias (as suítes de relógio
// deslocado adiantam o backend em até um dia). O aceite gasta 1 do limite de 10 por 15
// minutos por IP de `POST /invites/accept` (memória do processo do backend);
// cada suíte roda em invocação própria, com um backend novo.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

export const API_DE_TESTE = "http://localhost:3001";

const CRIADOR_EMAIL = "fixture-convites-playwright@example.test";

export interface DadosDeConta {
  ownerName: string;
  businessName: string;
  email: string;
  phone?: string;
  password: string;
}

/** Mesmo formato da resposta do antigo cadastro, para os testes existentes. */
export interface ContaDeTeste {
  user: { id: string; name: string; email: string };
  tenant: { id: string; slug: string; status: "TRIAL" };
  unit: { id: string; name: string; isPrimary: true };
  membership: { role: "DONO" };
  /** Instante gravado pelo `new Date()` do BACKEND no aceite: prova o
   * relógio do processo da API (as suítes de relógio deslocado conferem). */
  ativadaEm: string;
}

const novoId = () => randomUUID().replaceAll("-", "").slice(0, 24);

export async function conectarBancoDeTeste(): Promise<Client> {
  const url = process.env.DATABASE_URL;
  if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("A fixture de contas só conecta ao PostgreSQL descartável local (DATABASE_URL).");
  }
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await db.connect();
  return db;
}

/** Igual ao `slugify` do backend (sem acento, minúsculas, hífens) + sufixo único. */
function slugDe(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "estabelecimento"}-${randomBytes(3).toString("hex")}`;
}

/** Igual ao `normalizePhone` do backend. */
function telefoneDe(bruto: string | undefined): string | null {
  if (!bruto) return null;
  const digitos = bruto.replace(/\D/g, "");
  return bruto.trim().startsWith("+55") || (digitos.startsWith("55") && digitos.length > 11) ? `+${digitos}` : `+55${digitos}`;
}

/** Cria o convite de DONO de um estabelecimento novo e devolve o token. */
export async function prepararConviteDeDono(db: Client, dados: DadosDeConta) {
  await db.query(
    `INSERT INTO users (id, name, email, status) VALUES ($1, 'Fixture de testes', $2, 'ACTIVE')
     ON CONFLICT (email) DO NOTHING`,
    [novoId(), CRIADOR_EMAIL],
  );
  const [{ id: criador }] = (await db.query("SELECT id FROM users WHERE email = $1", [CRIADOR_EMAIL])).rows;
  const [{ id: planId }] = (await db.query("SELECT id FROM plans WHERE code = 'equipe'")).rows;
  const ids = { user: novoId(), tenant: novoId(), unit: novoId(), invite: novoId() };
  const slug = slugDe(dados.businessName);
  const token = randomBytes(32).toString("hex");
  await db.query("BEGIN");
  try {
    await db.query(
      `INSERT INTO users (id, name, email, phone, status) VALUES ($1, $2, $3, $4, 'INVITED')`,
      [ids.user, dados.ownerName, dados.email.trim().toLowerCase(), telefoneDe(dados.phone)],
    );
    await db.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, created_at, updated_at, access_legacy_since)
       VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'TRIAL', $4, $4, $4)`,
      // O período de teste conta do "agora" dos testes (relógio deslocado,
      // quando houver), como contava do relógio do backend no antigo cadastro.
      // Marcado como anterior ao controle de validade: opera sem período,
      // como os estabelecimentos do piloto (commercial/ no backend).
      [ids.tenant, slug, planId, new Date(Date.now() + (Number(process.env.E2E_RELOGIO_DESLOCAMENTO_MS) || 0))],
    );
    await db.query(
      `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', 'America/Sao_Paulo', true)`,
      [ids.unit, ids.tenant, dados.businessName],
    );
    await db.query(
      `INSERT INTO invites (id, type, target_name, target_email, tenant_id, establishment_role, status, token_hash,
          created_by_user_id, expires_at, target_user_id, delivery_status)
       VALUES ($1, 'ESTABLISHMENT', $2, $3, $4, 'DONO', 'PENDING', $5, $6, now() + interval '7 days', $7, 'SENT')`,
      [ids.invite, dados.ownerName, dados.email.trim().toLowerCase(), ids.tenant, createHash("sha256").update(token).digest("hex"), criador, ids.user],
    );
    await db.query("COMMIT");
  } catch (erro) {
    await db.query("ROLLBACK");
    throw erro;
  }
  return { token, ids, slug };
}

/**
 * Conta DONO pronta para os testes: estabelecimento novo e conta ativada pelo
 * aceite real do convite. Depois disto, `api` está autenticado como a conta.
 */
export async function criarContaDeTeste(api: APIRequestContext, dados: DadosDeConta): Promise<ContaDeTeste> {
  const db = await conectarBancoDeTeste();
  let preparado: Awaited<ReturnType<typeof prepararConviteDeDono>>;
  try {
    preparado = await prepararConviteDeDono(db, dados);
  } finally {
    await db.end();
  }
  const aceite = await api.post(`${API_DE_TESTE}/invites/accept`, {
    data: { token: preparado.token, password: dados.password },
  });
  expect(aceite.status(), await aceite.text()).toBe(200);
  const consulta = await conectarBancoDeTeste();
  let ativadaEm: string;
  try {
    const [linha] = (await consulta.query("SELECT accepted_at FROM invites WHERE id = $1", [preparado.ids.invite])).rows;
    ativadaEm = new Date(linha.accepted_at).toISOString();
  } finally {
    await consulta.end();
  }
  return {
    ativadaEm,
    user: { id: preparado.ids.user, name: dados.ownerName, email: dados.email.trim().toLowerCase() },
    tenant: { id: preparado.ids.tenant, slug: preparado.slug, status: "TRIAL" },
    unit: { id: preparado.ids.unit, name: dados.businessName, isPrimary: true },
    membership: { role: "DONO" },
  };
}
