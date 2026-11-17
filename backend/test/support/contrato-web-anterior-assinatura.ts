// CONTRATO DO WEB ANTERIOR À ASSINATURA MODULAR, congelado: cópia literal
// dos validadores de src/lib/administracao/contas.ts (`ehPlanos`),
// src/lib/administracao/contratos-validade.ts (`ehCatalogoDePrecos`) e
// src/lib/api/dashboard-api.ts (`ehPainel`) no commit df535a1 (integração
// antes deste lote; iguais em becc923, o web visto no Render em 17/11/2026).
//
// No intervalo da publicação a migration nova roda com a API anterior, e
// depois a API nova fica no ar com o web anterior. Os testes de banco rodam
// estes validadores sobre respostas reais: se o plano modular (sem
// `maxProfessionals`) vazar para uma lista que o web anterior lê, ou se o
// painel de um cliente atual perder os indicadores, o teste quebra. Não
// edite para "passar".
/* eslint-disable */

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const lista = (v: unknown): v is unknown[] => Array.isArray(v);

// ---- contas.ts
export function ehPlanos(v: unknown): boolean {
  const preco = (x: unknown) => x === null || inteiro(x);
  return (
    lista(v) &&
    v.every(
      (p) =>
        objeto(p) &&
        texto(p.id) &&
        texto(p.name) &&
        inteiro(p.maxProfessionals) &&
        (p.cyclePrices === undefined ||
          (objeto(p.cyclePrices) && preco(p.cyclePrices.MONTHLY) && preco(p.cyclePrices.QUARTERLY))),
    )
  );
}

// ---- contratos-validade.ts
const CICLOS_VALIDOS = ["MONTHLY", "QUARTERLY"];
const data = (value: unknown): value is string => texto(value) && Number.isFinite(Date.parse(value));
const talvez =
  <T,>(teste: (v: unknown) => v is T) =>
  (value: unknown): value is T | null =>
    value === null || teste(value);
const pessoa = (value: unknown) => objeto(value) && texto(value.id) && texto(value.name);

function ehMudancaDePreco(value: unknown): boolean {
  return (
    objeto(value) &&
    texto(value.id) &&
    texto(value.planId) &&
    texto(value.planName) &&
    CICLOS_VALIDOS.includes(value.cycle as string) &&
    talvez(inteiro)(value.amountCents) &&
    talvez(texto)(value.reason) &&
    data(value.recordedAt) &&
    pessoa(value.recordedBy)
  );
}

export function ehCatalogoDePrecos(value: unknown): boolean {
  return (
    objeto(value) &&
    typeof value.canManage === "boolean" &&
    Array.isArray(value.history) &&
    value.history.every(ehMudancaDePreco) &&
    Array.isArray(value.items) &&
    value.items.every(
      (p: unknown) =>
        objeto(p) &&
        texto(p.id) &&
        texto(p.code) &&
        texto(p.name) &&
        inteiro(p.maxProfessionals) &&
        Array.isArray(p.prices) &&
        p.prices.every(
          (c: unknown) =>
            objeto(c) && CICLOS_VALIDOS.includes(c.cycle as string) && (c.current === null || ehMudancaDePreco(c.current)),
        ),
    )
  );
}

// ---- dashboard-api.ts
const SITUACOES_ATENDIMENTO = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELED"] as const;
const numero = (v: unknown) => typeof v === "number" && Number.isFinite(v);

function porSituacao(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  return SITUACOES_ATENDIMENTO.every((s) => numero((v as Record<string, unknown>)[s]));
}

function ehProximo(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const nome = (o: unknown) => typeof o === "object" && o !== null && texto((o as Record<string, unknown>).name);
  return (
    texto(p.id) &&
    texto(p.startAt) &&
    texto(p.localDate) &&
    texto(p.localStart) &&
    (SITUACOES_ATENDIMENTO as readonly unknown[]).includes(p.status) &&
    nome(p.consumer) &&
    nome(p.service) &&
    nome(p.professional)
  );
}

export function ehPainel(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const periodo = p.period as Record<string, unknown> | undefined;
  const hoje = p.todaySummary as Record<string, unknown> | undefined;
  const noPeriodo = p.periodSummary as Record<string, unknown> | undefined;
  const plano = p.plan as Record<string, unknown> | undefined;
  const vagas = plano?.staffSeats as Record<string, unknown> | undefined;
  const financeiro = p.finance as Record<string, unknown> | undefined;
  return (
    texto(p.timezone) &&
    texto(p.today) &&
    texto(p.generatedAt) &&
    !!periodo &&
    texto(periodo.from) &&
    texto(periodo.to) &&
    !!hoje &&
    numero(hoje.expectedClients) &&
    porSituacao(hoje.appointmentsByStatus) &&
    !!noPeriodo &&
    numero(noPeriodo.servedClients) &&
    numero(noPeriodo.appointmentsTotal) &&
    porSituacao(noPeriodo.appointmentsByStatus) &&
    numero(p.pendingRequests) &&
    Array.isArray(p.upcoming) &&
    p.upcoming.every(ehProximo) &&
    !!plano &&
    texto(plano.name) &&
    numero(plano.maxProfessionals) &&
    numero(plano.activeProfessionals) &&
    !!vagas &&
    numero(vagas.used) &&
    numero(vagas.pending) &&
    numero(vagas.available) &&
    numero(vagas.limit) &&
    !!financeiro &&
    ["receivedCents", "refundedCents", "netCents", "paidAppointments", "paidTotalCents"].every((k) => numero(financeiro[k])) &&
    (financeiro.averageTicketCents === null || numero(financeiro.averageTicketCents))
  );
}

// ---- SQL da API anterior (df535a1), congelado
/** `GET platform/plans` da API anterior (accounts-directory.service.ts). */
export const LISTA_DE_PLANOS_DA_API_ANTERIOR = `SELECT id, code, name, price_cents AS "catalogPriceCents", max_professionals AS "maxProfessionals",
                max_units AS "maxUnits",
                json_build_object('MONTHLY', (SELECT pp.amount_cents FROM plan_prices pp WHERE pp.plan_id = plans.id AND pp.billing_cycle = 'MONTHLY'
         ORDER BY pp.recorded_at DESC, pp.id DESC LIMIT 1), 'QUARTERLY', (SELECT pp.amount_cents FROM plan_prices pp WHERE pp.plan_id = plans.id AND pp.billing_cycle = 'QUARTERLY'
         ORDER BY pp.recorded_at DESC, pp.id DESC LIMIT 1)) AS "cyclePrices"
           FROM plans ORDER BY max_professionals, name, id`;

/** Inserção do estabelecimento pela API anterior (invites.service.ts): sem
 * `team_user_limit` e sem assinatura. */
export const INSERCAO_DE_ESTABELECIMENTO_DA_API_ANTERIOR = `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, created_at, updated_at)
       VALUES ($1, $2, $3::business_category, $4, $5, 'TRIAL', $6, $6)`;

/** Troca de plano pela API anterior (establishment-admin.service.ts). */
export const TROCA_DE_PLANO_DA_API_ANTERIOR = `UPDATE tenants SET plan_id = $3, updated_at = GREATEST($2::timestamptz, updated_at + interval '1 millisecond') WHERE id = $1 RETURNING updated_at`;
