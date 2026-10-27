// Sonda: sobe a API de BACKEND_API_DIR contra DB_URL (descartável) e tenta o
// login de um dono fictício criado aqui. Imprime só status e a 1ª linha de erro.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const API_DIR = process.env.BACKEND_API_DIR;
const DB = process.env.DB_URL;
const PORT = process.env.SONDA_PORT ?? "3192";
const require = createRequire(`${API_DIR}/package.json`);
const { Client } = require("pg");
const { hashPassword } = await import(pathToFileURL(`${API_DIR}/dist/auth/password-hasher.js`).href);
const id = () => randomUUID().replaceAll("-", "").slice(0, 24);

const db = new Client({ connectionString: DB, ssl: { rejectUnauthorized: true } });
await db.connect();
const marca = `sonda-${id().slice(0, 8)}`;
const [{ id: plano }] = (await db.query(`SELECT id FROM plans LIMIT 1`)).rows;
const tenant = id();
await db.query(`INSERT INTO tenants (id, slug, category, timezone, plan_id, status) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE')`, [tenant, marca, plano]);
await db.query(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, 'U', '', 'America/Sao_Paulo', true)`, [id(), tenant]);
const u = id();
await db.query(`INSERT INTO users (id, name, email, email_verified, status, created_at, updated_at) VALUES ($1, 'Dono', $2, true, 'ACTIVE', now(), now())`, [u, `${marca}@example.test`]);
await db.query(`INSERT INTO credentials (id, user_id, password_hash, algorithm, updated_at) VALUES ($1, $2, $3, 'argon2id', now())`, [id(), u, await hashPassword("Senha-Sonda-123")]);
await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), u, tenant]);
await db.end();

let log = "";
const api = spawn(process.execPath, ["dist/main.js"], {
  cwd: API_DIR,
  env: { ...process.env, PORT, DATABASE_URL: DB, DIRECT_URL: DB, NODE_ENV: "development", FRONTEND_URL: "http://localhost:3000" },
});
api.stdout.on("data", (b) => (log += b));
api.stderr.on("data", (b) => (log += b));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++) {
  try { await fetch(`${base}/`); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
}
const raiz = await fetch(`${base}/`);
console.log(`GET_RAIZ: ${raiz.status}`);
const r = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
  body: JSON.stringify({ email: `${marca}@example.test`, password: "Senha-Sonda-123" }),
});
console.log(`LOGIN_DONO: ${r.status}`);
const erro = log.split("\n").find((l) => /column .* does not exist|QueryFailedError|ERROR/.test(l));
console.log(`PRIMEIRO_ERRO_NO_LOG: ${erro ? erro.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "").trim().slice(0, 160) : "nenhum"}`);
api.kill();
