// Ensaio de retorno: uma API (por padrão a publicada, c77c313) contra o banco
// descartável com o schema final e dados que só a API nova grava. Dados
// fictícios, banco local com TLS verificado. Imprime só status e fatos.
import { createRequire } from "node:module";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const BACKEND = process.env.BACKEND_DIR; // backend cujo pg/argon2 usar
const API = process.env.API_URL;
const DB = process.env.DB_URL;
const require = createRequire(`${BACKEND}/package.json`);
const { Client } = require("pg");
const { hashPassword } = await import(pathToFileURL(`${BACKEND}/dist/auth/password-hasher.js`).href);

const id = () => randomUUID().replaceAll("-", "").slice(0, 24);
const db = new Client({ connectionString: DB, ssl: { rejectUnauthorized: true } });
await db.connect();
const marca = `ensaio-${id().slice(0, 8)}`;
const SENHA = "Senha-Ensaio-Retorno-123";
const hash = await hashPassword(SENHA);
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

async function conta({ email = null, username = null, mustChange = false, platformRole = null }) {
  const u = id();
  await db.query(
    `INSERT INTO users (id, name, email, username, email_verified, status, must_change_password, platform_role, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7, now(), now())`,
    [u, `Pessoa ${marca}`, email, username, !!email, mustChange, platformRole],
  );
  await db.query(`INSERT INTO credentials (id, user_id, password_hash, algorithm, updated_at) VALUES ($1, $2, $3, 'argon2id', now())`, [
    id(), u, hash,
  ]);
  return u;
}
async function sessao(userId) {
  const token = randomBytes(32).toString("hex");
  await db.query(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, reauthenticated_at) VALUES ($1, $2, $3, now(), now() + interval '1 day', now())`,
    [id(), userId, createHash("sha256").update(token).digest("hex")],
  );
  return token;
}

// ---------------------------------------------------------------- cenário
const [{ id: plano }] = (await db.query(`SELECT id FROM plans ORDER BY max_professionals DESC LIMIT 1`)).rows;
const tenant = id();
const unit = id();
await db.query(`INSERT INTO tenants (id, slug, category, timezone, plan_id, status) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE')`, [tenant, marca, plano]);
await db.query(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, 'Unidade', '', 'America/Sao_Paulo', true)`, [unit, tenant]);
const dono = await conta({ email: `${marca}-dono@example.test` });
await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role, status) VALUES ($1, $2, $3, 'DONO', 'ACTIVE')`, [id(), dono, tenant]);
const prof = id();
await db.query(`INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, 'Ana', 'AN', '#000000')`, [prof, tenant]);
// Funcionário criado pela API nova: sem e-mail, com usuário, troca obrigatória.
const staff = await conta({ username: `${marca}-func`, mustChange: true });
const vinculoStaff = id();
await db.query(
  `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, status) VALUES ($1, $2, $3, 'PROFISSIONAL', $4, 'ACTIVE')`,
  [vinculoStaff, staff, tenant, prof],
);
const tokenStaff = await sessao(staff); // sessão aberta pela API nova antes do retorno
await conta({ email: `${marca}-admin@example.test`, platformRole: "MASTER_OWNER" });
// Atendimento confirmado amanhã, já quitado (recebimento ativo).
const servico = id();
await db.query(`INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte', '', 30, 5000)`, [servico, tenant]);
const cliente = id();
await db.query(`INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Ensaio', '11999990000', $3)`, [cliente, tenant, `55${Date.now()}`]);
const amanha = new Date(Date.now() + 26 * 3600_000);
amanha.setUTCMinutes(0, 0, 0);
const atendimento = id();
await db.query(
  `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot, professional_id, start_at, end_at, status)
   VALUES ($1, $2, $3, $4, 'Cliente Ensaio', '11999990000', $5, $6, $7, 'CONFIRMED')`,
  [atendimento, tenant, unit, cliente, prof, amanha, new Date(amanha.getTime() + 1_800_000)],
);
await db.query(
  `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot) VALUES ($1, $2, $3, $4, 30, 5000)`,
  [id(), tenant, atendimento, servico],
);
const pagamento = id();
await db.query(
  `INSERT INTO appointment_payments (id, tenant_id, appointment_id, amount_cents, method, received_on, recorded_by_user_id, request_key)
   VALUES ($1, $2, $3, 4250, 'PIX', current_date, $4, $5)`,
  [pagamento, tenant, atendimento, dono, `chave-${id()}`],
);
await db.query(
  `INSERT INTO audit_logs (id, action, actor_user_id, actor_name, tenant_id, summary, occurred_at)
   VALUES ($1, 'PAYMENT_RECORDED', $2, 'Dono', $3, 'Recebimento de 42.50 registrado.', now()),
          ($4, 'STAFF_ACCESS_CREATED', $2, 'Dono', $3, 'Acesso de funcionário criado.', now())`,
  [id(), dono, tenant, id()],
).catch((e) => out("AVISO_AUDITORIA_DIRETA", e.code ?? e.message));

// ---------------------------------------------------------------- HTTP
const ORIGEM = process.env.FRONTEND_URL ?? "http://localhost:3000";
async function chamar(metodo, caminho, { cookie, corpo } = {}) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { Origin: ORIGEM, ...(corpo ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: `session_token=${cookie}` } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* sem corpo JSON */ }
  const setCookie = r.headers.get("set-cookie") ?? "";
  return { status: r.status, json, cookie: /session_token=([^;]+)/.exec(setCookie)?.[1] };
}
const login = async (email) => (await chamar("POST", "/auth/login", { corpo: { email, password: SENHA } }));

const d = await login(`${marca}-dono@example.test`);
out("DONO_LOGIN", d.status);
out("DONO_ME", (await chamar("GET", "/auth/me", { cookie: d.cookie })).status);
const equipe = await chamar("GET", `/tenants/${tenant}/team`, { cookie: d.cookie });
const membroSemEmail = JSON.stringify(equipe.json ?? {}).includes(`${marca}-func`) || JSON.stringify(equipe.json ?? {}).includes(staff);
out("DONO_EQUIPE", `${equipe.status} lista_funcionario_sem_email=${membroSemEmail}`);
const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(amanha);
out("DONO_AGENDA", (await chamar("GET", `/tenants/${tenant}/appointments?date=${dia}`, { cookie: d.cookie })).status);
const cancelar = await chamar("POST", `/tenants/${tenant}/appointments/${atendimento}/cancel`, {
  cookie: d.cookie,
  corpo: { expectedStartAt: amanha.toISOString() },
});
const [pg] = (await db.query(`SELECT amount_cents::int, refunded_at FROM appointment_payments WHERE id = $1`, [pagamento])).rows;
out("DONO_CANCELA_ATENDIMENTO_PAGO", `${cancelar.status} recebimento_intacto=${pg.amount_cents === 4250 && pg.refunded_at === null}`);

out("FUNC_LOGIN_POR_USUARIO", (await chamar("POST", "/auth/login", { corpo: { email: `${marca}-func`, password: SENHA } })).status);
out("FUNC_LOGIN_POR_LOGIN", (await chamar("POST", "/auth/login", { corpo: { login: `${marca}-func`, password: SENHA } })).status);
const meStaff = await chamar("GET", "/auth/me", { cookie: tokenStaff });
out("FUNC_SESSAO_ABERTA_ME", meStaff.status);
out("FUNC_SESSAO_ABERTA_MINHA_AGENDA", (await chamar("GET", `/tenants/${tenant}/my-agenda?date=${dia}`, { cookie: tokenStaff })).status);

const a = await login(`${marca}-admin@example.test`);
out("ADMIN_LOGIN", a.status);
const usuarios = await chamar("GET", `/platform/users?q=${marca}`, { cookie: a.cookie });
out("ADMIN_USUARIOS", `${usuarios.status} itens=${JSON.stringify(usuarios.json ?? {}).split(marca).length - 1}`);
const fichaStaff = await chamar("GET", `/platform/users/${staff}`, { cookie: a.cookie });
out("ADMIN_FICHA_FUNC_SEM_EMAIL", `${fichaStaff.status} email=${JSON.stringify(fichaStaff.json?.user?.email ?? fichaStaff.json?.email ?? null)}`);
out("ADMIN_HISTORICO", (await chamar("GET", `/platform/audit`, { cookie: a.cookie })).status);
out("ADMIN_HISTORICO_DO_TENANT", (await chamar("GET", `/platform/audit?tenantId=${tenant}`, { cookie: a.cookie })).status);
out("ADMIN_MEMBROS_DO_TENANT", (await chamar("GET", `/platform/establishments/${tenant}/members`, { cookie: a.cookie })).status);
out("ADMIN_FICHA_TENANT", (await chamar("GET", `/platform/establishments/${tenant}`, { cookie: a.cookie })).status);
const reauth = await chamar("POST", "/platform/reauth", { cookie: a.cookie, corpo: { password: SENHA } });
out("ADMIN_REAUTH", reauth.status);
const redefinir = await chamar("POST", `/platform/users/${staff}/password-reset`, {
  cookie: a.cookie,
  corpo: { requestKey: `chave-${id()}` },
});
const [{ n: links }] = (await db.query(`SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1`, [staff])).rows;
out("ADMIN_REDEFINIR_SENHA_FUNC_SEM_EMAIL", `${redefinir.status} code=${redefinir.json?.code ?? redefinir.json?.message ?? "-"} links_gravados=${links}`);

await db.end();
