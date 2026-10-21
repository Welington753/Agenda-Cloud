import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { inicioDoRelogioDeTeste } from "./tests/browser/data-de-teste";

// RELÓGIO DE TESTE para os specs que dependem da hora do dia (Visão geral e
// visualização da agenda): backend e navegador começam às 10:00 do "hoje" do
// estabelecimento, qualquer que seja a hora real (ver
// `inicioDoRelogioDeTeste`). Fora isso, é a configuração padrão: mesmo banco
// descartável, mesmo backend compilado, mesma API real. Cada spec roda em
// invocação própria (orçamento de cadastro e login), com backend novo.
//
// O deslocamento é calculado UMA vez, no processo principal, e herdado pelo
// worker e pelo backend pelo ambiente: perto da meia-noite, recalcular em
// cada processo poderia cair em dias diferentes. `E2E_RELOGIO_INICIO` (ISO
// 8601) troca o instante de início, só para verificar outros horários à mão.
//
// `reuseExistingServer: false` sempre: um backend já rodando teria o relógio
// real, e o spec conferiria horários que ele não vê.
const inicio = process.env.E2E_RELOGIO_INICIO
  ? new Date(process.env.E2E_RELOGIO_INICIO)
  : inicioDoRelogioDeTeste(new Date());
if (Number.isNaN(inicio.getTime())) throw new Error("E2E_RELOGIO_INICIO inválido");
process.env.E2E_RELOGIO_DESLOCAMENTO_MS ??= String(inicio.getTime() - Date.now());

const [backend, frontend] = Array.isArray(base.webServer) ? base.webServer : [];

export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: [
    "visao-geral-flow.spec.ts",
    "agenda-view-flow.spec.ts",
    "agenda-por-profissional-flow.spec.ts",
  ],
  webServer: [
    {
      ...backend,
      command: "node --import ../tests/browser/support/relogio-deslocado.mjs dist/main.js",
      env: { ...backend.env, E2E_RELOGIO_DESLOCAMENTO_MS: process.env.E2E_RELOGIO_DESLOCAMENTO_MS },
      reuseExistingServer: false,
    },
    { ...frontend, reuseExistingServer: false },
  ],
});
