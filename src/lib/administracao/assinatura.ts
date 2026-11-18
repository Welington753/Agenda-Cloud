// Assinatura modular no portal (aba "Plano e adicionais" e criação do
// estabelecimento): contratos das respostas e regras puras da tela. O
// servidor confere tudo de novo; aqui só se calcula o que mostrar antes de
// salvar (docs/plans/assinatura-modular-e-limite-equipe.md).
import { reais } from "./validade";

export type Disponibilidade = "AVAILABLE" | "IN_DEVELOPMENT" | "PLANNED";

export const ROTULO_DISPONIBILIDADE: Record<Disponibilidade, string> = {
  AVAILABLE: "Disponível",
  IN_DEVELOPMENT: "Em desenvolvimento",
  PLANNED: "Planejado",
};

export const LIMITE_MAXIMO_DE_USUARIOS = 1000;

export interface Adicional {
  code: string;
  name: string;
  description: string;
  featureKey: string | null;
  availability: Disponibilidade;
  /** Preço mensal em vigor; `null`: a definir (pendente). */
  priceCents: number | null;
}

/** Nome com que o essencial nasce; a tela usa sempre o atual, vindo da API. */
export const NOME_ESSENCIAL_PADRAO = "Agendamento essencial";

/** Agendamento essencial como está no catálogo agora (editável só em Planos e
 * adicionais). */
export interface ItemEssencial {
  planId: string;
  name: string;
  description: string;
  /** Preço mensal padrão em vigor; `null`: a definir (pendente). */
  priceCents: number | null;
}

export interface CatalogoAssinatura {
  basePriceCents: number | null;
  basePlanId: string;
  essential: ItemEssencial;
  addons: Adicional[];
  history: {
    id: string;
    moduleCode: string;
    moduleName: string;
    amountCents: number;
    reason: string | null;
    recordedAt: string;
    recordedBy: string;
  }[];
  canManage: boolean;
}

export interface VersaoAssinatura {
  id: string;
  version: number;
  effectiveAt: string;
  baseCatalogCents: number;
  catalogTotalCents: number;
  contractedTotalCents: number;
  negotiated: boolean;
  reason: string | null;
  teamUserLimit: number;
  previousContract: Record<string, unknown> | null;
  recordedAt: string;
  recordedBy: string;
  items: { code: string; name: string; catalogPriceCents: number }[];
}

export interface UsoDeVagas {
  limit: number;
  activeAccesses: number;
  pendingInvites: number;
  suspendedAccesses: number;
  used: number;
  available: number;
}

export interface ContratoAnterior {
  planId: string;
  contractCycle: string | null;
  contractCents: number | null;
  lastPaidCycle: string | null;
  lastPaidCents: number | null;
  paidUntil: string | null;
}

export interface VisaoAssinatura {
  tenantId: string;
  updatedAt: string;
  status: string;
  modular: boolean;
  plan: { id: string; name: string; maxProfessionals: number | null };
  teamUserLimit: { value: number; source: "TENANT" | "PLAN" };
  seats: UsoDeVagas;
  enabledAddons: string[];
  current: VersaoAssinatura | null;
  history: VersaoAssinatura[];
  catalog: { basePriceCents: number | null; essential: ItemEssencial; addons: Adicional[] };
  conversion: { previousContract: ContratoAnterior; requiresCycleChange: boolean } | null;
  canManage: boolean;
}

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const talvez = (teste: (v: unknown) => boolean) => (v: unknown) => v === null || teste(v);
const DISPONIBILIDADES: readonly string[] = ["AVAILABLE", "IN_DEVELOPMENT", "PLANNED"];

function ehAdicional(v: unknown): v is Adicional {
  return (
    objeto(v) &&
    texto(v.code) &&
    texto(v.name) &&
    texto(v.description) &&
    talvez(texto)(v.featureKey) &&
    DISPONIBILIDADES.includes(v.availability as string) &&
    talvez(inteiro)(v.priceCents)
  );
}

function ehEssencial(v: unknown): v is ItemEssencial {
  return objeto(v) && texto(v.planId) && texto(v.name) && texto(v.description) && talvez(inteiro)(v.priceCents);
}

function ehVersao(v: unknown): v is VersaoAssinatura {
  return (
    objeto(v) &&
    texto(v.id) &&
    inteiro(v.version) &&
    texto(v.effectiveAt) &&
    inteiro(v.baseCatalogCents) &&
    inteiro(v.catalogTotalCents) &&
    inteiro(v.contractedTotalCents) &&
    typeof v.negotiated === "boolean" &&
    talvez(texto)(v.reason) &&
    inteiro(v.teamUserLimit) &&
    texto(v.recordedAt) &&
    texto(v.recordedBy) &&
    Array.isArray(v.items) &&
    v.items.every((i: unknown) => objeto(i) && texto(i.code) && texto(i.name) && inteiro(i.catalogPriceCents))
  );
}

function ehUso(v: unknown): v is UsoDeVagas {
  return objeto(v) && ["limit", "activeAccesses", "pendingInvites", "suspendedAccesses", "used", "available"].every((k) => inteiro(v[k]));
}

export function ehCatalogoAssinatura(v: unknown): v is CatalogoAssinatura {
  return (
    objeto(v) &&
    talvez(inteiro)(v.basePriceCents) &&
    texto(v.basePlanId) &&
    ehEssencial(v.essential) &&
    Array.isArray(v.addons) &&
    v.addons.every(ehAdicional) &&
    Array.isArray(v.history) &&
    typeof v.canManage === "boolean"
  );
}

export function ehVisaoAssinatura(v: unknown): v is VisaoAssinatura {
  return (
    objeto(v) &&
    texto(v.tenantId) &&
    texto(v.updatedAt) &&
    typeof v.modular === "boolean" &&
    objeto(v.plan) &&
    texto(v.plan.name) &&
    objeto(v.teamUserLimit) &&
    inteiro(v.teamUserLimit.value) &&
    ehUso(v.seats) &&
    Array.isArray(v.enabledAddons) &&
    v.enabledAddons.every(texto) &&
    (v.current === null || ehVersao(v.current)) &&
    Array.isArray(v.history) &&
    v.history.every(ehVersao) &&
    objeto(v.catalog) &&
    talvez(inteiro)(v.catalog.basePriceCents) &&
    ehEssencial(v.catalog.essential) &&
    Array.isArray(v.catalog.addons) &&
    v.catalog.addons.every(ehAdicional) &&
    (v.conversion === null || (objeto(v.conversion) && typeof v.conversion.requiresCycleChange === "boolean")) &&
    typeof v.canManage === "boolean"
  );
}

/** Só entra no total o que é disponível e tem preço. */
export function contratavel(a: Adicional): boolean {
  return a.availability === "AVAILABLE" && a.featureKey !== null && a.priceCents !== null;
}

export interface Escolha {
  itens: { code: string; name: string; priceCents: number }[];
  totalCatalogoCents: number | null;
  totalContratadoCents: number | null;
  negociado: boolean;
  /** O que impede salvar (preço pendente, motivo faltando). */
  pendencias: string[];
}

/** Total da escolha: base + adicionais contratáveis selecionados. Valor
 * combinado diferente do catálogo exige motivo. */
export function calcularEscolha(
  baseCents: number | null,
  adicionais: readonly Adicional[],
  selecionados: readonly string[],
  combinado: { centavos: number | null; motivo: string } = { centavos: null, motivo: "" },
  nomeEssencial: string = NOME_ESSENCIAL_PADRAO,
): Escolha {
  const pendencias: string[] = [];
  if (baseCents === null) pendencias.push(`O preço de ${nomeEssencial} ainda não foi definido em Planos e adicionais.`);
  const itens: Escolha["itens"] = [];
  for (const code of selecionados) {
    const a = adicionais.find((x) => x.code === code);
    if (!a) continue;
    if (a.availability !== "AVAILABLE") continue;
    if (a.priceCents === null) {
      pendencias.push(`O preço de ${a.name} ainda não foi definido.`);
      continue;
    }
    itens.push({ code: a.code, name: a.name, priceCents: a.priceCents });
  }
  const totalCatalogoCents = baseCents === null ? null : itens.reduce((s, i) => s + i.priceCents, baseCents);
  const totalContratadoCents = combinado.centavos ?? totalCatalogoCents;
  const negociado = combinado.centavos !== null && combinado.centavos !== totalCatalogoCents;
  if (negociado && combinado.motivo.trim().length < 3) pendencias.push("Informe o motivo do valor negociado.");
  return { itens, totalCatalogoCents, totalContratadoCents, negociado, pendencias };
}

/** Limite digitado: inteiro de 0 a 1000 e nunca abaixo do uso atual. */
export function validarLimite(digitado: string, uso: Pick<UsoDeVagas, "used" | "activeAccesses" | "pendingInvites"> | null) {
  const limpo = digitado.trim();
  if (!/^\d{1,4}$/.test(limpo)) return { valor: null, erro: "Informe um número inteiro (0 = nenhuma conta de equipe)." };
  const valor = Number(limpo);
  if (valor > LIMITE_MAXIMO_DE_USUARIOS) return { valor: null, erro: `O limite máximo é ${LIMITE_MAXIMO_DE_USUARIOS}.` };
  if (uso && valor < uso.used) {
    return {
      valor: null,
      erro:
        `Abaixo do uso atual: ${uso.activeAccesses} acesso(s) ativo(s) e ${uso.pendingInvites} reservado(s) por convite. ` +
        "Revogue convites ou suspenda acessos antes; nada é desativado automaticamente.",
    };
  }
  return { valor, erro: null };
}

export interface Revisao {
  linhas: string[];
  avisos: string[];
  /** Adicionais hoje liberados que deixariam de ser (exigem confirmação). */
  retirados: string[];
}

/** O que a revisão mostra antes de salvar: novo valor recorrente, diferença,
 * limite, retiradas e a regra de vigência. */
export function revisarAssinatura(entrada: {
  atual: VersaoAssinatura | null;
  ligadosHoje: readonly string[];
  adicionais: readonly Adicional[];
  escolha: Escolha;
  limite: number;
  limiteAtual: number | null;
  conversao: VisaoAssinatura["conversion"];
  /** Nome atual do essencial no catálogo. */
  nomeEssencial?: string;
}): Revisao {
  const { escolha } = entrada;
  const linhas: string[] = [];
  const nomes = escolha.itens.map((i) => i.name);
  linhas.push(`${entrada.nomeEssencial ?? NOME_ESSENCIAL_PADRAO}${nomes.length ? ` + ${nomes.join(", ")}` : " (sem adicionais)"}.`);
  if (escolha.totalContratadoCents !== null) {
    linhas.push(`Novo valor recorrente: ${reais(escolha.totalContratadoCents)}/mês.`);
    if (escolha.negociado && escolha.totalCatalogoCents !== null) {
      linhas.push(`Valor do catálogo: ${reais(escolha.totalCatalogoCents)}/mês (valor negociado).`);
    }
    const anterior = entrada.atual?.contractedTotalCents ?? null;
    if (anterior !== null) {
      const dif = escolha.totalContratadoCents - anterior;
      linhas.push(
        dif === 0
          ? `Mesmo valor da versão atual (${reais(anterior)}/mês).`
          : `${dif > 0 ? "Aumento" : "Redução"} de ${reais(Math.abs(dif))}/mês em relação a ${reais(anterior)}/mês.`,
      );
    }
  }
  linhas.push(
    `Limite de usuários da equipe: ${entrada.limite}` +
      (entrada.limiteAtual !== null && entrada.limiteAtual !== entrada.limite ? ` (hoje ${entrada.limiteAtual})` : "") +
      ". O limite não muda a mensalidade.",
  );
  const escolhidos = new Set(escolha.itens.map((i) => i.code));
  const retirados = entrada.ligadosHoje
    .filter((c) => !escolhidos.has(c))
    .map((c) => entrada.adicionais.find((a) => a.code === c)?.name ?? c);
  const avisos = [
    "Vale a partir de agora para os próximos períodos registrados. Não há cobrança retroativa nem proporcional; nenhum pagamento é registrado aqui.",
  ];
  if (retirados.length) {
    avisos.push(`Deixa de estar liberado: ${retirados.join(", ")}. O histórico desses recursos é preservado.`);
  }
  if (entrada.conversao) {
    avisos.push("O estabelecimento sai do plano anterior e passa para a assinatura modular mensal.");
    const c = entrada.conversao.previousContract;
    if (entrada.conversao.requiresCycleChange) {
      const valor = c.contractCents ?? c.lastPaidCents;
      const ate = c.paidUntil ? new Date(c.paidUntil).toLocaleDateString("pt-BR") : null;
      avisos.push(
        `Contrato trimestral${valor !== null ? ` de ${reais(valor)}/trimestre` : ""} deixa de valer.` +
          (ate ? ` O período já pago continua válido até ${ate}.` : "") +
          " Sem estorno nem cobrança proporcional; os próximos períodos serão mensais.",
      );
    }
  }
  return { linhas, avisos, retirados };
}
