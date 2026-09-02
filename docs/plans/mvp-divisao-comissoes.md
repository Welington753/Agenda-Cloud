# MVP Divisão Interna de Comissões — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagent-driven-development and subagents are explicitly OUT of scope — execute inline in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular e registrar, para cada agendamento concluído, quanto do valor cobrado pertence ao profissional e quanto pertence ao estabelecimento, com regra configurável por combinação profissional+serviço, histórico imutável e relatório de conferência — sem qualquer integração financeira real.

**Architecture:** Segue exatamente o padrão já usado por disponibilidade (`src/lib/availability/engine.ts` puro + `consulta.ts` orientado a repositório): um módulo `src/lib/comissoes/engine.ts` 100% puro (cálculo, arredondamento, validação, totais) sem dependência de storage, testável isoladamente; dois novos repositórios (`comissaoRegraRepository`, `lancamentoComissaoRepository`) adicionados ao arquivo único `src/lib/repositories/index.ts` (mesmo padrão dos repositórios existentes); e o gatilho de consolidação/estorno embutido diretamente em `agendamentoRepository.atualizarStatus`/`remarcar` (mesmo arquivo, sem import circular) para garantir idempotência não importa quem chame.

**Tech Stack:** Next.js (App Router, `"use client"`), TypeScript, Vitest, `localStorage` via `src/lib/storage/local-storage.ts`.

**Spec:** Requisitos definidos pelo usuário nesta conversa. Precondição verificada: branch `feat/melhorias-frontend`, HEAD `4785eae`, working tree limpa, 60 testes/lint/build (20 rotas) passando antes de qualquer alteração.

## Global Constraints

- NÃO é split de pagamento nem integração financeira — só cálculo e registro interno.
- Não mexer em Prisma, banco, NestJS, TypeORM, Neon, `.env`, dependências.
- Não instalar biblioteca de teste de componentes — só testes de função pura, repositório e acesso.
- Dinheiro sempre em centavos, inteiro, nunca `float`.
- Regra configurada só por combinação `profissional + serviço` — sem regra padrão do estabelecimento, sem hierarquia, sem fechamento financeiro, sem "pago"/"não pago" nesta fase.
- Sem regra configurada: comissão do profissional = R$0, estabelecimento fica com 100%, atendimento pode ser concluído normalmente.
- Cálculo usa o preço congelado no próprio `Agendamento.precoCentavos`, nunca relê `Servico.precoCentavos` atual.
- Cancelado e falta nunca geram lançamento. Concluído gera exatamente um lançamento, idempotente. Reversão de concluído marca o lançamento existente como `estornado`, nunca apaga.
- Alterar/remover uma `RegraComissao` depois nunca modifica um `LancamentoComissao` já criado (snapshot congelado).
- Sem backfill automático de agendamentos já concluídos antes desta implementação.
- Nenhum campo novo em tipo existente pode quebrar dados antigos do `localStorage` — toda extensão é opcional ou tem coleção nova com seed automático via `readCollection`.
- `comissoes` só sai de `FEATURES_AINDA_NAO_IMPLEMENTADAS` no final, quando tudo estiver funcional — sem mudar quais planos incluem a feature.
- Permissões: esconder botão nunca é suficiente — toda função de mutação confere `podeAcessar` de novo, e sempre valida `tenantId`.

---

## Contexto já mapeado (não precisa re-explorar)

- `src/lib/types.ts` — `Agendamento.precoCentavos` já é cópia congelada no momento da criação (mesmo padrão que o snapshot de comissão vai seguir). `Servico.duracaoMinutos`/`profissionaisIds`, `Profissional.servicosIds` (fonte usada pelo resto do app para "quem faz o quê" — `modal-novo-agendamento.tsx` filtra por `profissional.servicosIds`, não pelo lado inverso). `Permission` é union de strings. `Feature` já tem `"comissoes"` listada.
- `src/lib/planos.ts` — só o plano `"pro"` inclui a feature `"comissoes"` (`DEFINICOES_PLANO.pro.features`). `FEATURES_AINDA_NAO_IMPLEMENTADAS` inclui `"comissoes"` — controla só o badge "Em breve" nas telas master (`master/estabelecimentos/novo` e `master/estabelecimentos/[id]`), não afeta lógica de acesso.
- `src/lib/access/access-control.ts` — `calcularAcessoEfetivo` já resolve feature-por-plano automaticamente para qualquer permissão presente em `PERMISSAO_PARA_FEATURE` (passos 4-5 da função). Isso significa: **basta mapear as duas novas permissões para a feature `"comissoes"` que rota protegida + menu escondido + mutação bloqueada saem de graça**, sem código extra em nenhuma tela. `STATUS_TENANT_FUNCIONAL` e o resto da função não mudam.
- `src/lib/tenant/tenant-context.tsx` — `useTenant().podeAcessar(permissao)` já é o único ponto de checagem usado pelas páginas do painel.
- `src/lib/repositories/index.ts` — todos os repositórios num arquivo só, padrão `listarTodos` (lê via `readCollection` com seed) / `listarPorTenant` / `obterPorId` / `criar` / `atualizar` / `remover`. `agendamentoRepository.atualizarStatus` e `.remarcar` são os dois únicos pontos que mudam `Agendamento.status` — é aqui que o gatilho de comissão entra, sem precisar tocar em nenhuma página.
- `src/lib/storage/local-storage.ts` — `readCollection(chave, seed)` semeia automaticamente na primeira leitura se a chave não existir. Adicionar chaves novas em `STORAGE_KEYS` nunca invalida coleções existentes — não precisa subir o `NAMESPACE` (`v3`).
- `src/lib/seed-data.ts` — `obterSeedCompleto()` memoiza tudo num cache só; `prof-joao-silva` (tenant `TENANT_DOM_NAVALHA`, plano `pro`) tem `serv-corte-tradicional` (R$40,00) em `servicosIds`, e `serv-corte-tradicional.profissionaisIds` inclui `prof-joao-silva` de volta — par válido e já consistente nos dois lados, ótimo para a regra de demonstração.
- `src/app/painel/layout.tsx` — menu filtra itens por `podeAcessar(permissao).permitido`; acesso direto pela URL é bloqueado por `RequirePermission` dentro da página, não pelo menu.
- `src/app/painel/servicos/page.tsx` / `profissionais/page.tsx` — padrão de referência para: `RequirePermission` envolvendo a página, `podeAcessar("x.gerenciar").permitido` calculado uma vez e usado tanto para esconder botão quanto como guarda no início da função de mutação.
- `src/lib/format.ts` — `formatarMoeda(centavos)`, `formatarData(iso)` já existem, reaproveitar.
- Testes de repositório existentes (`src/lib/repositories/tenant-isolation.test.ts`) usam um fake mínimo de `localStorage` via `vi.stubGlobal("window", {...})` em `beforeEach` — mesmo padrão para os testes novos de repositório.

---

### Task 1: Tipos de domínio (`RegraComissao`, `LancamentoComissao`) e novas permissões

**Files:**
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces: `TipoComissao = "percentual" | "fixo"`; `StatusLancamentoComissao = "confirmado" | "estornado"`; `interface RegraComissao`; `interface LancamentoComissao`; `Permission` ganha `"comissoes.visualizar" | "comissoes.gerenciar"`.

- [ ] **Step 1: Adicionar os tipos de comissão em `src/lib/types.ts`**, logo depois da interface `Agendamento` (antes do separador `// ---------------------------------------------------------------------------\n// Contas, vínculos e permissões`):

```typescript
export type TipoComissao = "percentual" | "fixo";

/** `confirmado` = lançamento válido, entra nos totais do relatório. `estornado` =
 * o agendamento que o gerou foi revertido depois de concluído; o registro nunca é
 * apagado, só marcado — histórico permanece auditável. */
export type StatusLancamentoComissao = "confirmado" | "estornado";

/** Regra de comissão para UMA combinação profissional+serviço. No máximo uma por
 * `tenantId`+`profissionalId`+`servicoId` — `comissaoRegraRepository.salvar` faz
 * upsert por essa chave, então a unicidade é estrutural, não uma checagem separada.
 * `valor`: percentual é 0-100 (não fração); fixo é centavos. */
export interface RegraComissao {
  id: string;
  tenantId: string;
  profissionalId: string;
  servicoId: string;
  tipo: TipoComissao;
  valor: number;
  criadoEm: string;
  atualizadoEm: string;
}

/** Lançamento gerado quando um agendamento é concluído — cópia congelada dos
 * valores no momento do cálculo. Nunca é recalculado a partir da regra atual;
 * alterar ou remover a `RegraComissao` depois não toca nenhum `LancamentoComissao`
 * já existente. No máximo um lançamento por `agendamentoId`, para sempre — mesmo
 * que ele tenha sido estornado, um novo nunca é criado para o mesmo agendamento. */
export interface LancamentoComissao {
  id: string;
  tenantId: string;
  agendamentoId: string;
  profissionalId: string;
  servicoId: string;
  precoAgendamentoCentavos: number;
  tipoComissao: TipoComissao;
  valorRegraAplicada: number;
  valorProfissionalCentavos: number;
  valorEstabelecimentoCentavos: number;
  /** = `Agendamento.dataHoraInicio` no momento do cálculo. */
  dataAtendimento: string;
  calculadoEm: string;
  status: StatusLancamentoComissao;
}
```

- [ ] **Step 2: Adicionar as duas permissões novas ao union `Permission`**, logo antes de `"personalizacao.gerenciar"`:

```typescript
  | "equipe.visualizar"
  | "equipe.gerenciar"
  | "comissoes.visualizar"
  | "comissoes.gerenciar"
  | "personalizacao.gerenciar"
  | "configuracoes.gerenciar";
```

- [ ] **Step 3: `npm run build` só para checar que o TypeScript compila** (nada consome os tipos novos ainda, então é só validação sintática). Expected: sucesso, sem erros de tipo.

---

### Task 2: Motor puro de comissão (`src/lib/comissoes/engine.ts`) — TDD

**Files:**
- Create: `src/lib/comissoes/engine.ts`
- Create: `src/lib/comissoes/engine.test.ts`

**Interfaces:**
- Consumes: `TipoComissao`, `RegraComissao`, `LancamentoComissao`, `Profissional`, `Servico` de `@/lib/types` (Task 1).
- Produces: `calcularComissao(precoAgendamentoCentavos, regra): ResultadoCalculoComissao`; `validarRegraComissao(entrada): ResultadoValidacaoRegra`; `calcularTotaisRelatorio(lancamentos): TotaisComissao`. Usados por: repositório (Task 3) e página (Task 6).

- [ ] **Step 1: Escrever `engine.test.ts` primeiro (todos os testes de cálculo/validação)**

```typescript
import { describe, expect, it } from "vitest";
import { calcularComissao, calcularTotaisRelatorio, validarRegraComissao } from "./engine";
import type { LancamentoComissao, Profissional, Servico } from "@/lib/types";

function profissional(overrides: Partial<Profissional> = {}): Profissional {
  return {
    id: "prof-1",
    tenantId: "t1",
    nome: "João",
    avatarIniciais: "JO",
    corAvatar: "#000",
    servicosIds: ["serv-1"],
    horarios: [],
    agendamentoOnlineAtivo: true,
    ativo: true,
    ...overrides,
  };
}

function servico(overrides: Partial<Servico> = {}): Servico {
  return {
    id: "serv-1",
    tenantId: "t1",
    nome: "Corte",
    descricaoCurta: "",
    precoCentavos: 10000,
    precoVisivel: true,
    duracaoMinutos: 30,
    intervaloPosteriorMinutos: 0,
    modalidade: "presencial",
    profissionaisIds: ["prof-1"],
    ativoNoAgendamentoPublico: true,
    exigeConfirmacaoManual: false,
    ativo: true,
    ...overrides,
  };
}

describe("calcularComissao", () => {
  it("40% de R$100 dá R$40 para o profissional e R$60 para o estabelecimento", () => {
    const resultado = calcularComissao(10000, { tipo: "percentual", valor: 40 });
    expect(resultado.valorProfissionalCentavos).toBe(4000);
    expect(resultado.valorEstabelecimentoCentavos).toBe(6000);
  });

  it("comissão fixa de R$40 em serviço de R$100 dá R$40 para o profissional e R$60 para o estabelecimento", () => {
    const resultado = calcularComissao(10000, { tipo: "fixo", valor: 4000 });
    expect(resultado.valorProfissionalCentavos).toBe(4000);
    expect(resultado.valorEstabelecimentoCentavos).toBe(6000);
  });

  it("arredonda de forma determinística para o centavo mais próximo (,5 arredonda para cima)", () => {
    // R$10,01 (1001 centavos) × 50% = 500,5 centavos exatos.
    const resultado = calcularComissao(1001, { tipo: "percentual", valor: 50 });
    expect(resultado.valorProfissionalCentavos).toBe(501);
    expect(resultado.valorEstabelecimentoCentavos).toBe(500);
    expect(resultado.valorProfissionalCentavos + resultado.valorEstabelecimentoCentavos).toBe(1001);
  });

  it("sem regra (0%) deixa o profissional com R$0 e o estabelecimento com 100%", () => {
    const resultado = calcularComissao(10000, { tipo: "percentual", valor: 0 });
    expect(resultado.valorProfissionalCentavos).toBe(0);
    expect(resultado.valorEstabelecimentoCentavos).toBe(10000);
  });

  it("nunca deixa o valor do profissional exceder o preço do agendamento, mesmo com regra fixa desatualizada", () => {
    // Regra fixa de R$40 validada contra um preço de serviço que depois caiu para
    // R$30 no agendamento — o cálculo protege o resultado sem precisar confiar
    // que a regra ainda é compatível com este agendamento específico.
    const resultado = calcularComissao(3000, { tipo: "fixo", valor: 4000 });
    expect(resultado.valorProfissionalCentavos).toBe(3000);
    expect(resultado.valorEstabelecimentoCentavos).toBe(0);
  });
});

describe("validarRegraComissao", () => {
  it("rejeita percentual menor que 0", () => {
    const resultado = validarRegraComissao({ tipo: "percentual", valor: -1, profissional: profissional(), servico: servico() });
    expect(resultado.valido).toBe(false);
  });

  it("rejeita percentual maior que 100", () => {
    const resultado = validarRegraComissao({ tipo: "percentual", valor: 101, profissional: profissional(), servico: servico() });
    expect(resultado.valido).toBe(false);
  });

  it("aceita percentual nas bordas 0 e 100", () => {
    expect(validarRegraComissao({ tipo: "percentual", valor: 0, profissional: profissional(), servico: servico() }).valido).toBe(true);
    expect(validarRegraComissao({ tipo: "percentual", valor: 100, profissional: profissional(), servico: servico() }).valido).toBe(true);
  });

  it("rejeita valor fixo negativo", () => {
    const resultado = validarRegraComissao({ tipo: "fixo", valor: -100, profissional: profissional(), servico: servico() });
    expect(resultado.valido).toBe(false);
  });

  it("rejeita valor fixo maior que o preço do serviço", () => {
    const resultado = validarRegraComissao({
      tipo: "fixo",
      valor: 10001,
      profissional: profissional(),
      servico: servico({ precoCentavos: 10000 }),
    });
    expect(resultado.valido).toBe(false);
  });

  it("rejeita profissional e serviço de tenants diferentes", () => {
    const resultado = validarRegraComissao({
      tipo: "percentual",
      valor: 10,
      profissional: profissional({ tenantId: "t1" }),
      servico: servico({ tenantId: "t2" }),
    });
    expect(resultado.valido).toBe(false);
  });

  it("rejeita serviço não vinculado ao profissional", () => {
    const resultado = validarRegraComissao({
      tipo: "percentual",
      valor: 10,
      profissional: profissional({ servicosIds: ["outro-servico"] }),
      servico: servico({ id: "serv-1" }),
    });
    expect(resultado.valido).toBe(false);
  });

  it("aceita combinação válida", () => {
    const resultado = validarRegraComissao({ tipo: "percentual", valor: 40, profissional: profissional(), servico: servico() });
    expect(resultado.valido).toBe(true);
  });
});

describe("calcularTotaisRelatorio", () => {
  function lancamento(overrides: Partial<LancamentoComissao> = {}): LancamentoComissao {
    return {
      id: "lanc-1",
      tenantId: "t1",
      agendamentoId: "ag-1",
      profissionalId: "prof-1",
      servicoId: "serv-1",
      precoAgendamentoCentavos: 10000,
      tipoComissao: "percentual",
      valorRegraAplicada: 40,
      valorProfissionalCentavos: 4000,
      valorEstabelecimentoCentavos: 6000,
      dataAtendimento: "2026-01-10T10:00:00.000Z",
      calculadoEm: "2026-01-10T11:00:00.000Z",
      status: "confirmado",
      ...overrides,
    };
  }

  it("soma serviços, profissional e estabelecimento de todos os lançamentos passados", () => {
    const totais = calcularTotaisRelatorio([
      lancamento({ id: "lanc-1" }),
      lancamento({ id: "lanc-2", precoAgendamentoCentavos: 5000, valorProfissionalCentavos: 2000, valorEstabelecimentoCentavos: 3000 }),
    ]);
    expect(totais.totalServicosCentavos).toBe(15000);
    expect(totais.totalProfissionalCentavos).toBe(6000);
    expect(totais.totalEstabelecimentoCentavos).toBe(9000);
  });

  it("lista vazia retorna totais zerados", () => {
    const totais = calcularTotaisRelatorio([]);
    expect(totais).toEqual({ totalServicosCentavos: 0, totalProfissionalCentavos: 0, totalEstabelecimentoCentavos: 0 });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham** (arquivo `engine.ts` ainda não existe)

Run: `npm run test -- comissoes`
Expected: FAIL — não consegue resolver `./engine`.

- [ ] **Step 3: Implementar `src/lib/comissoes/engine.ts`**

```typescript
// Motor de comissão: funções puras, sem dependência de storage — mesmo padrão de
// src/lib/availability/engine.ts. `consulta`/orquestração fica no repositório
// (src/lib/repositories/index.ts), não aqui.

import type { LancamentoComissao, Profissional, Servico, TipoComissao } from "@/lib/types";

export interface RegraAplicada {
  tipo: TipoComissao;
  valor: number;
}

export interface ResultadoCalculoComissao {
  valorProfissionalCentavos: number;
  valorEstabelecimentoCentavos: number;
}

/** Calcula a divisão a partir do preço já congelado no agendamento — nunca relê o
 * preço atual do serviço. Arredondamento: `Math.round`, determinístico, ,5
 * arredonda para cima (comportamento padrão do JS para números positivos). O
 * valor do profissional nunca excede o preço do agendamento, mesmo que a regra
 * fixa tenha sido validada contra um preço de serviço diferente do congelado. */
export function calcularComissao(precoAgendamentoCentavos: number, regra: RegraAplicada): ResultadoCalculoComissao {
  const bruto = regra.tipo === "percentual" ? Math.round((precoAgendamentoCentavos * regra.valor) / 100) : regra.valor;
  const valorProfissionalCentavos = Math.max(0, Math.min(bruto, precoAgendamentoCentavos));
  const valorEstabelecimentoCentavos = precoAgendamentoCentavos - valorProfissionalCentavos;
  return { valorProfissionalCentavos, valorEstabelecimentoCentavos };
}

export interface EntradaValidacaoRegra {
  tipo: TipoComissao;
  valor: number;
  profissional: Pick<Profissional, "tenantId" | "servicosIds">;
  servico: Pick<Servico, "id" | "tenantId" | "precoCentavos">;
}

export interface ResultadoValidacaoRegra {
  valido: boolean;
  erro?: string;
}

/** Validação pura de uma regra antes de gravar — a UI chama isto antes de
 * `comissaoRegraRepository.salvar`. Não garante unicidade (isso é estrutural no
 * repositório, upsert por profissional+serviço). */
export function validarRegraComissao(entrada: EntradaValidacaoRegra): ResultadoValidacaoRegra {
  if (entrada.profissional.tenantId !== entrada.servico.tenantId) {
    return { valido: false, erro: "Profissional e serviço precisam pertencer ao mesmo estabelecimento." };
  }
  if (!entrada.profissional.servicosIds.includes(entrada.servico.id)) {
    return { valido: false, erro: "Este serviço não está vinculado a este profissional." };
  }
  if (entrada.tipo === "percentual") {
    if (entrada.valor < 0 || entrada.valor > 100) {
      return { valido: false, erro: "O percentual precisa estar entre 0% e 100%." };
    }
  } else {
    if (entrada.valor < 0) {
      return { valido: false, erro: "O valor fixo não pode ser negativo." };
    }
    if (entrada.servico.precoCentavos !== undefined && entrada.valor > entrada.servico.precoCentavos) {
      return { valido: false, erro: "O valor fixo não pode ser maior que o preço do serviço." };
    }
  }
  return { valido: true };
}

export interface TotaisComissao {
  totalServicosCentavos: number;
  totalProfissionalCentavos: number;
  totalEstabelecimentoCentavos: number;
}

/** Soma simples do que for passado — a página decide o que filtrar (período,
 * profissional, status) antes de chamar isto; a função não tem opinião sobre
 * incluir ou não lançamentos estornados. */
export function calcularTotaisRelatorio(lancamentos: LancamentoComissao[]): TotaisComissao {
  return lancamentos.reduce(
    (totais, l) => ({
      totalServicosCentavos: totais.totalServicosCentavos + l.precoAgendamentoCentavos,
      totalProfissionalCentavos: totais.totalProfissionalCentavos + l.valorProfissionalCentavos,
      totalEstabelecimentoCentavos: totais.totalEstabelecimentoCentavos + l.valorEstabelecimentoCentavos,
    }),
    { totalServicosCentavos: 0, totalProfissionalCentavos: 0, totalEstabelecimentoCentavos: 0 }
  );
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- comissoes`
Expected: PASS — 16 testes (5 `calcularComissao` + 8 `validarRegraComissao` + 2 `calcularTotaisRelatorio` + a de bordas 0/100 conta como 1 `it` com 2 expects).

- [ ] **Step 5: Rodar a suíte inteira para garantir que nada mais quebrou**

Run: `npm run test`
Expected: PASS, total = 60 + 16 = 76.

---

### Task 3: Repositórios (`comissaoRegraRepository`, `lancamentoComissaoRepository`) e gatilho de consolidação/estorno

**Files:**
- Modify: `src/lib/storage/local-storage.ts`
- Modify: `src/lib/repositories/index.ts`
- Modify: `src/lib/seed-data.ts`
- Test: `src/lib/repositories/comissoes.test.ts` (novo)

**Interfaces:**
- Consumes: `calcularComissao` de `src/lib/comissoes/engine.ts` (Task 2). `RegraComissao`, `LancamentoComissao` de `@/lib/types` (Task 1).
- Produces: `comissaoRegraRepository.{listarTodos, listarPorTenant, obterPorProfissionalEServico, salvar, remover}`; `lancamentoComissaoRepository.{listarTodos, listarPorTenant, obterPorAgendamentoId, criar, estornar}`. `agendamentoRepository.atualizarStatus`/`.remarcar` passam a disparar consolidação/estorno automaticamente — nenhuma mudança de assinatura, comportamento aditivo.

- [ ] **Step 1: Adicionar as duas chaves novas em `STORAGE_KEYS`** (`src/lib/storage/local-storage.ts`), sem tocar em nenhuma chave existente nem no `NAMESPACE`:

```typescript
export const STORAGE_KEYS = {
  estabelecimentos: "estabelecimentos",
  profissionais: "profissionais",
  servicos: "servicos",
  consumidores: "consumidores",
  agendamentos: "agendamentos",
  bloqueios: "bloqueios",
  unidades: "unidades",
  recursos: "recursos",
  usuariosPlataforma: "usuarios-plataforma",
  usuariosEstabelecimento: "usuarios-estabelecimento",
  memberships: "memberships",
  convites: "convites",
  auditoria: "auditoria",
  regrasComissao: "regras-comissao",
  lancamentosComissao: "lancamentos-comissao",
} as const;
```

- [ ] **Step 2: Adicionar seed de regra de demonstração em `src/lib/seed-data.ts`**

Adicionar, perto das outras funções `gerar*Seed`:

```typescript
export function gerarRegrasComissaoSeed(): RegraComissao[] {
  return [
    {
      id: "regra-comissao-joao-corte-tradicional",
      tenantId: TENANT_DOM_NAVALHA,
      profissionalId: "prof-joao-silva",
      servicoId: "serv-corte-tradicional",
      tipo: "percentual",
      valor: 40,
      criadoEm: addDays(new Date(), -30).toISOString(),
      atualizadoEm: addDays(new Date(), -30).toISOString(),
    },
  ];
}
```

Adicionar `RegraComissao` e `LancamentoComissao` ao import de tipos no topo do arquivo. Adicionar `regrasComissao: RegraComissao[]` e `lancamentosComissao: LancamentoComissao[]` ao tipo `seedCompletoCache` e a `obterSeedCompleto()`:

```typescript
regrasComissao: gerarRegrasComissaoSeed(),
lancamentosComissao: [], // sem backfill — só passa a existir a partir de agendamentos concluídos depois desta implementação
```

- [ ] **Step 3: Escrever `src/lib/repositories/comissoes.test.ts` primeiro (idempotência, estorno, isolamento, dados antigos)**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agendamentoRepository,
  comissaoRegraRepository,
  estabelecimentoRepository,
  lancamentoComissaoRepository,
  profissionalRepository,
  servicoRepository,
} from "./index";

function criarLocalStorageFake() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => (dados.has(chave) ? (dados.get(chave) as string) : null),
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: criarLocalStorageFake() });
});

function tenantDomNavalha() {
  return estabelecimentoRepository.obterPorSlug("dom-navalha")!;
}

/** Cria e confirma um agendamento novo de João + Corte tradicional (par com regra
 * de 40% já semeada), pronto para ser concluído nos testes. */
function criarAgendamentoDeTeste(precoCentavos = 4000) {
  const tenant = tenantDomNavalha();
  const profissional = profissionalRepository.obterPorId("prof-joao-silva")!;
  const servico = servicoRepository.obterPorId("serv-corte-tradicional")!;
  return agendamentoRepository.criar({
    tenantId: tenant.tenantId,
    consumidorId: "cons-teste",
    consumidorNome: "Cliente Teste",
    consumidorWhatsapp: "(11) 90000-0000",
    profissionalId: profissional.id,
    servicoId: servico.id,
    dataHoraInicio: new Date("2026-02-10T10:00:00.000Z").toISOString(),
    dataHoraFim: new Date("2026-02-10T10:30:00.000Z").toISOString(),
    status: "pendente",
    precoCentavos,
  });
}

describe("consolidação de comissão ao concluir agendamento", () => {
  it("agendamento concluído gera exatamente um lançamento com os valores da regra ativa (40%)", () => {
    const agendamento = criarAgendamentoDeTeste(4000);
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");

    const lancamento = lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id);
    expect(lancamento).toBeDefined();
    expect(lancamento!.valorProfissionalCentavos).toBe(1600); // 40% de 4000
    expect(lancamento!.valorEstabelecimentoCentavos).toBe(2400);
    expect(lancamento!.status).toBe("confirmado");
  });

  it("agendamento cancelado não gera lançamento", () => {
    const agendamento = criarAgendamentoDeTeste();
    agendamentoRepository.atualizarStatus(agendamento.id, "cancelado", "dono");
    expect(lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)).toBeUndefined();
  });

  it("falta do cliente não gera lançamento", () => {
    const agendamento = criarAgendamentoDeTeste();
    agendamentoRepository.atualizarStatus(agendamento.id, "nao_compareceu", "dono");
    expect(lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)).toBeUndefined();
  });

  it("concluir o mesmo agendamento duas vezes não duplica o lançamento", () => {
    const agendamento = criarAgendamentoDeTeste();
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    const todos = lancamentoComissaoRepository.listarTodos().filter((l) => l.agendamentoId === agendamento.id);
    expect(todos).toHaveLength(1);
  });

  it("alterar a regra depois não muda um lançamento já criado", () => {
    const agendamento = criarAgendamentoDeTeste(4000);
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    const antes = lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)!;
    expect(antes.valorProfissionalCentavos).toBe(1600);

    comissaoRegraRepository.salvar({
      tenantId: antes.tenantId,
      profissionalId: "prof-joao-silva",
      servicoId: "serv-corte-tradicional",
      tipo: "percentual",
      valor: 90,
    });

    const depois = lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)!;
    expect(depois.valorProfissionalCentavos).toBe(1600); // não recalculado
    expect(depois.valorRegraAplicada).toBe(40); // snapshot da regra antiga
  });

  it("reverter um agendamento concluído estorna o lançamento sem apagá-lo", () => {
    const agendamento = criarAgendamentoDeTeste();
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    agendamentoRepository.atualizarStatus(agendamento.id, "cancelado", "dono");

    const lancamento = lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id);
    expect(lancamento).toBeDefined(); // continua existindo
    expect(lancamento!.status).toBe("estornado");
  });

  it("sem regra configurada, lançamento sai com comissão zero e 100% para o estabelecimento", () => {
    const tenant = tenantDomNavalha();
    const profissional = profissionalRepository.obterPorId("prof-pedro-martins")!; // sem regra semeada
    const servico = servicoRepository.obterPorId("serv-barba")!;
    const agendamento = agendamentoRepository.criar({
      tenantId: tenant.tenantId,
      consumidorId: "cons-teste-2",
      consumidorNome: "Cliente Teste 2",
      consumidorWhatsapp: "(11) 90000-0001",
      profissionalId: profissional.id,
      servicoId: servico.id,
      dataHoraInicio: new Date("2026-02-11T10:00:00.000Z").toISOString(),
      dataHoraFim: new Date("2026-02-11T10:30:00.000Z").toISOString(),
      status: "pendente",
      precoCentavos: 3000,
    });
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    const lancamento = lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)!;
    expect(lancamento.valorProfissionalCentavos).toBe(0);
    expect(lancamento.valorEstabelecimentoCentavos).toBe(3000);
  });
});

describe("isolamento por tenant", () => {
  it("comissaoRegraRepository e lancamentoComissaoRepository nunca misturam tenants", () => {
    const domNavalha = tenantDomNavalha();
    const clinica = estabelecimentoRepository.obterPorSlug("clinica-sorriso-leve")!;

    const regrasNavalha = comissaoRegraRepository.listarPorTenant(domNavalha.tenantId);
    const regrasClinica = comissaoRegraRepository.listarPorTenant(clinica.tenantId);
    expect(regrasNavalha.length).toBeGreaterThan(0);
    expect(regrasNavalha.every((r) => r.tenantId === domNavalha.tenantId)).toBe(true);
    expect(regrasClinica.every((r) => r.tenantId === clinica.tenantId)).toBe(true);

    const agendamento = criarAgendamentoDeTeste();
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    const lancamentosClinica = lancamentoComissaoRepository.listarPorTenant(clinica.tenantId);
    expect(lancamentosClinica.some((l) => l.agendamentoId === agendamento.id)).toBe(false);
  });
});

describe("compatibilidade com dados existentes", () => {
  it("coleções antigas continuam carregando normalmente mesmo com as chaves novas introduzidas", () => {
    // Simula um localStorage "antigo": só grava as coleções que já existiam antes
    // desta feature, nunca toca em regras/lançamentos de comissão.
    const agendamentosAntes = agendamentoRepository.listarTodos();
    expect(agendamentosAntes.length).toBeGreaterThan(0);

    // As coleções novas devem semear sozinhas na primeira leitura, sem exigir
    // nenhuma migração manual e sem apagar nada que já existia.
    const regras = comissaoRegraRepository.listarTodos();
    const lancamentos = lancamentoComissaoRepository.listarTodos();
    expect(Array.isArray(regras)).toBe(true);
    expect(Array.isArray(lancamentos)).toBe(true);
    expect(agendamentoRepository.listarTodos().length).toBe(agendamentosAntes.length);
  });
});
```

- [ ] **Step 4: Rodar os testes e confirmar que falham** (repositórios ainda não existem)

Run: `npm run test -- repositories/comissoes`
Expected: FAIL — `comissaoRegraRepository`/`lancamentoComissaoRepository` não exportados.

- [ ] **Step 5: Implementar os repositórios e o gatilho em `src/lib/repositories/index.ts`**

Adicionar `RegraComissao`, `LancamentoComissao` ao import de tipos no topo, e `import { calcularComissao } from "@/lib/comissoes/engine";`. Adicionar, depois do bloco `// ---------- Bloqueios ----------` (ou em qualquer ponto antes de `agendamentoRepository`, já que este último passa a depender destes dois):

```typescript
// ---------- Regras de comissão ----------
export const comissaoRegraRepository = {
  listarTodos(): RegraComissao[] {
    return readCollection(STORAGE_KEYS.regrasComissao, obterSeedCompleto().regrasComissao);
  },
  listarPorTenant(tenantId: string): RegraComissao[] {
    return this.listarTodos().filter((r) => r.tenantId === tenantId);
  },
  obterPorProfissionalEServico(tenantId: string, profissionalId: string, servicoId: string): RegraComissao | undefined {
    return this.listarTodos().find(
      (r) => r.tenantId === tenantId && r.profissionalId === profissionalId && r.servicoId === servicoId
    );
  },
  /** Upsert por tenantId+profissionalId+servicoId — garante estruturalmente que só
   * existe uma regra ativa por combinação, sem precisar de uma checagem separada
   * de unicidade nem de um campo `ativa`. */
  salvar(dados: Omit<RegraComissao, "id" | "criadoEm" | "atualizadoEm">): RegraComissao {
    const todos = this.listarTodos();
    const agora = new Date().toISOString();
    const existente = this.obterPorProfissionalEServico(dados.tenantId, dados.profissionalId, dados.servicoId);
    if (existente) {
      const atualizada: RegraComissao = { ...existente, tipo: dados.tipo, valor: dados.valor, atualizadoEm: agora };
      writeCollection(STORAGE_KEYS.regrasComissao, todos.map((r) => (r.id === existente.id ? atualizada : r)));
      return atualizada;
    }
    const nova: RegraComissao = { ...dados, id: gerarId("comregra"), criadoEm: agora, atualizadoEm: agora };
    writeCollection(STORAGE_KEYS.regrasComissao, [...todos, nova]);
    return nova;
  },
  remover(id: string): void {
    writeCollection(STORAGE_KEYS.regrasComissao, this.listarTodos().filter((r) => r.id !== id));
  },
};

// ---------- Lançamentos de comissão ----------
export const lancamentoComissaoRepository = {
  listarTodos(): LancamentoComissao[] {
    return readCollection(STORAGE_KEYS.lancamentosComissao, obterSeedCompleto().lancamentosComissao);
  },
  listarPorTenant(tenantId: string): LancamentoComissao[] {
    return this.listarTodos().filter((l) => l.tenantId === tenantId);
  },
  /** No máximo um lançamento por agendamento, para sempre — mesmo estornado, nunca
   * é substituído por um novo. */
  obterPorAgendamentoId(agendamentoId: string): LancamentoComissao | undefined {
    return this.listarTodos().find((l) => l.agendamentoId === agendamentoId);
  },
  /** Idempotente: se já existir um lançamento para este `agendamentoId` (em
   * qualquer status), retorna o existente em vez de criar outro — protege mesmo
   * que algum chamador futuro esqueça de checar antes. */
  criar(dados: Omit<LancamentoComissao, "id">): LancamentoComissao {
    const existente = this.obterPorAgendamentoId(dados.agendamentoId);
    if (existente) return existente;
    const novo: LancamentoComissao = { ...dados, id: gerarId("comlanc") };
    writeCollection(STORAGE_KEYS.lancamentosComissao, [...this.listarTodos(), novo]);
    return novo;
  },
  /** Marca como estornado — nunca remove o registro do histórico. */
  estornar(id: string): LancamentoComissao | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((l) => l.id === id);
    if (idx === -1) return undefined;
    todos[idx] = { ...todos[idx], status: "estornado" };
    writeCollection(STORAGE_KEYS.lancamentosComissao, todos);
    return todos[idx];
  },
};

/** Gera o lançamento de comissão quando um agendamento é concluído. Sem preço
 * definido no agendamento ("sob consulta"), não há valor para dividir — não gera
 * lançamento. Sem regra configurada para o par profissional+serviço, gera um
 * lançamento com comissão 0 (100% para o estabelecimento), conforme a regra de
 * negócio: ausência de configuração nunca impede a conclusão do atendimento. */
function consolidarComissaoDoAgendamento(agendamento: Agendamento): void {
  if (agendamento.precoCentavos === undefined) return;
  const regra = comissaoRegraRepository.obterPorProfissionalEServico(
    agendamento.tenantId,
    agendamento.profissionalId,
    agendamento.servicoId
  );
  const regraAplicada = regra ? { tipo: regra.tipo, valor: regra.valor } : { tipo: "percentual" as const, valor: 0 };
  const { valorProfissionalCentavos, valorEstabelecimentoCentavos } = calcularComissao(agendamento.precoCentavos, regraAplicada);
  lancamentoComissaoRepository.criar({
    tenantId: agendamento.tenantId,
    agendamentoId: agendamento.id,
    profissionalId: agendamento.profissionalId,
    servicoId: agendamento.servicoId,
    precoAgendamentoCentavos: agendamento.precoCentavos,
    tipoComissao: regraAplicada.tipo,
    valorRegraAplicada: regraAplicada.valor,
    valorProfissionalCentavos,
    valorEstabelecimentoCentavos,
    dataAtendimento: agendamento.dataHoraInicio,
    calculadoEm: new Date().toISOString(),
    status: "confirmado",
  });
}

/** Estorna (nunca apaga) o lançamento de um agendamento que deixou de estar
 * concluído depois de já ter gerado comissão. */
function estornarComissaoDoAgendamento(agendamentoId: string): void {
  const existente = lancamentoComissaoRepository.obterPorAgendamentoId(agendamentoId);
  if (existente && existente.status === "confirmado") {
    lancamentoComissaoRepository.estornar(existente.id);
  }
}
```

Depois, alterar `agendamentoRepository.atualizarStatus` e `.remarcar` para chamar essas duas funções — adicionar logo antes do `return todos[idx];` em cada um:

```typescript
  atualizarStatus(id: string, novoStatus: StatusAgendamento, por: string): Agendamento | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((a) => a.id === id);
    if (idx === -1) return undefined;
    const anterior = todos[idx];
    todos[idx] = {
      ...anterior,
      status: novoStatus,
      historico: [...anterior.historico, { em: new Date().toISOString(), de: anterior.status, para: novoStatus, por }],
    };
    writeCollection(STORAGE_KEYS.agendamentos, todos);
    if (novoStatus === "concluido" && anterior.status !== "concluido") {
      consolidarComissaoDoAgendamento(todos[idx]);
    } else if (anterior.status === "concluido" && novoStatus !== "concluido") {
      estornarComissaoDoAgendamento(id);
    }
    return todos[idx];
  },
  remarcar(id: string, novoInicio: string, novoFim: string, por: string): Agendamento | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((a) => a.id === id);
    if (idx === -1) return undefined;
    const anterior = todos[idx];
    todos[idx] = {
      ...anterior,
      dataHoraInicio: novoInicio,
      dataHoraFim: novoFim,
      status: "pendente",
      historico: [...anterior.historico, { em: new Date().toISOString(), de: anterior.status, para: "pendente", por }],
    };
    writeCollection(STORAGE_KEYS.agendamentos, todos);
    if (anterior.status === "concluido") {
      estornarComissaoDoAgendamento(id);
    }
    return todos[idx];
  },
```

(`consolidarComissaoDoAgendamento`/`estornarComissaoDoAgendamento` e os dois repositórios novos ficam definidos ANTES de `agendamentoRepository` no arquivo, já que `atualizarStatus`/`remarcar` os referenciam — colocar o bloco "Regras de comissão"/"Lançamentos de comissão" logo depois de `// ---------- Bloqueios ----------` e antes de `// ---------- Unidades ----------`, mantendo `agendamentoRepository` onde já está, mais abaixo no arquivo.)

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npm run test -- repositories/comissoes`
Expected: PASS — 9 testes.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm run test`
Expected: PASS, total = 76 + 9 = 85. Também rodar `npm run test -- tenant-isolation` isoladamente para confirmar que o gatilho novo dentro de `atualizarStatus` não quebrou nenhum teste de disponibilidade existente (nenhum desses testes conclui agendamento, mas confirmar mesmo assim).

---

### Task 4: Permissões — matriz de acesso e menu

**Files:**
- Modify: `src/lib/access/access-control.ts`
- Modify: `src/lib/access/access-control.test.ts`
- Modify: `src/app/painel/layout.tsx`

**Interfaces:**
- Consumes: `"comissoes.visualizar" | "comissoes.gerenciar"` de `Permission` (Task 1).
- Produces: nenhuma função nova — só dados (`PERMISSAO_PARA_FEATURE`, `PERMISSOES_PADRAO_POR_PAPEL`) e um item de menu. `calcularAcessoEfetivo` não muda de assinatura.

- [ ] **Step 1: Escrever os testes que falham em `access-control.test.ts`** (novo `describe`, no final do arquivo):

```typescript
describe("permissões de comissões", () => {
  it("dono no plano pro vê e gerencia comissões", () => {
    expect(calcularAcessoEfetivo(baseEntrada({ permissao: "comissoes.visualizar", papel: "dono", plano: "pro" })).permitido).toBe(true);
    expect(calcularAcessoEfetivo(baseEntrada({ permissao: "comissoes.gerenciar", papel: "dono", plano: "pro" })).permitido).toBe(true);
  });

  it("recepcionista não gerencia comissões mesmo no plano pro", () => {
    const resultado = calcularAcessoEfetivo(baseEntrada({ permissao: "comissoes.gerenciar", papel: "recepcionista", plano: "pro" }));
    expect(resultado.permitido).toBe(false);
  });

  it("plano sem a feature comissoes bloqueia acesso mesmo para o dono", () => {
    const resultado = calcularAcessoEfetivo(baseEntrada({ permissao: "comissoes.visualizar", papel: "dono", plano: "equipe" }));
    expect(resultado.permitido).toBe(false);
    expect(resultado.motivo).toMatch(/plano/i);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npm run test -- access-control.test.ts`
Expected: FAIL nos 3 novos casos (permissões ainda não existem na matriz).

- [ ] **Step 3: Adicionar as permissões na matriz de acesso**

Em `src/lib/access/access-control.ts`:

```typescript
export const PERMISSAO_PARA_FEATURE: Partial<Record<Permission, Feature>> = {
  "agenda.visualizar": "agenda",
  "agenda.gerenciar": "agenda",
  "agendamento.criar": "agenda",
  "agendamento.editar": "agenda",
  "agendamento.cancelar": "agenda",
  "profissionais.visualizar": "profissionais",
  "profissionais.gerenciar": "profissionais",
  "consumidores.visualizar": "consumidores",
  "consumidores.gerenciar": "consumidores",
  "relatorios.visualizar": "relatorios",
  "equipe.visualizar": "equipe",
  "equipe.gerenciar": "equipe",
  "comissoes.visualizar": "comissoes",
  "comissoes.gerenciar": "comissoes",
};
```

```typescript
const TODAS_AS_PERMISSOES: Permission[] = [
  "dashboard.visualizar",
  "agenda.visualizar",
  "agenda.gerenciar",
  "agendamento.criar",
  "agendamento.editar",
  "agendamento.cancelar",
  "profissionais.visualizar",
  "profissionais.gerenciar",
  "servicos.visualizar",
  "servicos.gerenciar",
  "consumidores.visualizar",
  "consumidores.gerenciar",
  "relatorios.visualizar",
  "equipe.visualizar",
  "equipe.gerenciar",
  "comissoes.visualizar",
  "comissoes.gerenciar",
  "personalizacao.gerenciar",
  "configuracoes.gerenciar",
];
```

Em `PERMISSOES_PADRAO_POR_PAPEL.gerente`, adicionar `"comissoes.visualizar", "comissoes.gerenciar"` à lista (gerente já gerencia serviços e profissionais — comissão é a mesma camada de configuração). `recepcionista` e `profissional` não recebem nada — ficam de fora da lista deles (sem tela financeira própria do profissional nesta fase, e recepção não configura comissão).

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm run test -- access-control.test.ts`
Expected: PASS.

- [ ] **Step 5: Adicionar o item de menu em `src/app/painel/layout.tsx`**

Importar o ícone `Percent` de `lucide-react` (adicionar ao import existente). Adicionar ao array `itensCandidatos`, entre "Equipe e acessos" e "Personalização":

```typescript
{ href: "/painel/comissoes", rotulo: "Comissões", icone: Percent, permissao: "comissoes.visualizar" },
```

- [ ] **Step 6: Rodar suíte inteira, lint**

Run: `npm run test && npm run lint`
Expected: PASS. Total de testes = 85 + 3 = 88.

---

### Task 5: Tela `/painel/comissoes` — configuração e relatório

**Files:**
- Create: `src/app/painel/comissoes/page.tsx`

**Interfaces:**
- Consumes: `comissaoRegraRepository`, `lancamentoComissaoRepository`, `profissionalRepository`, `servicoRepository` (Task 3); `calcularComissao`, `validarRegraComissao`, `calcularTotaisRelatorio` (Task 2); `useTenant().podeAcessar` (Task 4); `RequirePermission`, `formatarMoeda`, `formatarData`.

- [ ] **Step 1: Criar a página com as duas áreas — Configuração e Relatório**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Percent } from "lucide-react";
import { useClientData } from "@/lib/hooks/use-client-data";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { comissaoRegraRepository, lancamentoComissaoRepository, profissionalRepository, servicoRepository } from "@/lib/repositories";
import { calcularComissao, calcularTotaisRelatorio, validarRegraComissao } from "@/lib/comissoes/engine";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatarData, formatarMoeda } from "@/lib/format";
import type { RegraComissao, StatusLancamentoComissao, TipoComissao } from "@/lib/types";

export default function PainelComissoesPage() {
  return (
    <RequirePermission permissao="comissoes.visualizar">
      <ConteudoComissoes />
    </RequirePermission>
  );
}

function ConteudoComissoes() {
  const { tenantId, podeAcessar } = useTenant();
  const { notificar } = useToast();
  const podeGerenciar = podeAcessar("comissoes.gerenciar").permitido;

  const [profissionalSelecionadoId, setProfissionalSelecionadoId] = useState("");
  const [filtroProfissionalId, setFiltroProfissionalId] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState<StatusLancamentoComissao | "todos">("todos");
  const [filtroInicio, setFiltroInicio] = useState("");
  const [filtroFim, setFiltroFim] = useState("");

  const { dados, carregando, recarregar } = useClientData(
    () => ({
      profissionais: profissionalRepository.listarPorTenant(tenantId).filter((p) => p.ativo),
      servicos: servicoRepository.listarPorTenant(tenantId),
      regras: comissaoRegraRepository.listarPorTenant(tenantId),
      lancamentos: lancamentoComissaoRepository.listarPorTenant(tenantId),
    }),
    [tenantId]
  );

  const lancamentosFiltrados = useMemo(() => {
    if (!dados) return [];
    return dados.lancamentos.filter((l) => {
      if (filtroProfissionalId !== "todos" && l.profissionalId !== filtroProfissionalId) return false;
      if (filtroStatus !== "todos" && l.status !== filtroStatus) return false;
      if (filtroInicio && l.dataAtendimento < filtroInicio) return false;
      if (filtroFim && l.dataAtendimento > `${filtroFim}T23:59:59.999Z`) return false;
      return true;
    });
  }, [dados, filtroProfissionalId, filtroStatus, filtroInicio, filtroFim]);

  const totais = useMemo(() => calcularTotaisRelatorio(lancamentosFiltrados), [lancamentosFiltrados]);

  if (carregando || !dados) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { profissionais, servicos, regras } = dados;
  const profissionalPorId = new Map(profissionais.map((p) => [p.id, p]));
  const servicoPorId = new Map(servicos.map((s) => [s.id, s]));
  const profissionalSelecionado = profissionais.find((p) => p.id === profissionalSelecionadoId);
  const servicosDoProfissional = profissionalSelecionado
    ? servicos.filter((s) => profissionalSelecionado.servicosIds.includes(s.id))
    : [];

  function salvarRegra(profissionalId: string, servicoId: string, tipo: TipoComissao, valor: number) {
    if (!podeGerenciar) return;
    const profissional = profissionais.find((p) => p.id === profissionalId);
    const servico = servicos.find((s) => s.id === servicoId);
    if (!profissional || !servico) return;
    const validacao = validarRegraComissao({ tipo, valor, profissional, servico });
    if (!validacao.valido) {
      notificar(validacao.erro ?? "Regra de comissão inválida.", "erro");
      return;
    }
    comissaoRegraRepository.salvar({ tenantId, profissionalId, servicoId, tipo, valor });
    notificar("Comissão salva.", "sucesso");
    recarregar();
  }

  function removerRegra(regra: RegraComissao) {
    if (!podeGerenciar) return;
    if (!window.confirm("Remover esta regra de comissão? O profissional passa a ficar sem comissão configurada neste serviço.")) return;
    comissaoRegraRepository.remover(regra.id);
    notificar("Regra removida.", "sucesso");
    recarregar();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-ink">Comissões</h1>
        <p className="text-sm text-ink-soft">Quanto cada atendimento concluído reparte entre profissional e estabelecimento.</p>
      </div>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <h2 className="text-lg font-semibold text-ink">Configuração</h2>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Profissional</label>
            <select
              value={profissionalSelecionadoId}
              onChange={(e) => setProfissionalSelecionadoId(e.target.value)}
              className="w-full max-w-sm rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="">Selecione...</option>
              {profissionais.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>

          {profissionalSelecionado && servicosDoProfissional.length === 0 && (
            <EstadoVazio icone={Percent} titulo="Este profissional não tem serviços vinculados." />
          )}

          {profissionalSelecionado &&
            servicosDoProfissional.map((servico) => {
              const regra = regras.find((r) => r.profissionalId === profissionalSelecionado.id && r.servicoId === servico.id);
              return (
                <LinhaConfiguracaoServico
                  key={servico.id}
                  profissionalId={profissionalSelecionado.id}
                  servico={servico}
                  regra={regra}
                  podeGerenciar={podeGerenciar}
                  onSalvar={salvarRegra}
                  onRemover={removerRegra}
                />
              );
            })}
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <h2 className="text-lg font-semibold text-ink">Relatório</h2>
          <div className="flex flex-wrap gap-2">
            <select
              value={filtroProfissionalId}
              onChange={(e) => setFiltroProfissionalId(e.target.value)}
              className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="todos">Todos os profissionais</option>
              {profissionais.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as StatusLancamentoComissao | "todos")}
              className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="todos">Todos os status</option>
              <option value="confirmado">Confirmado</option>
              <option value="estornado">Estornado</option>
            </select>
            <input
              type="date"
              value={filtroInicio}
              onChange={(e) => setFiltroInicio(e.target.value)}
              className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
            <input
              type="date"
              value={filtroFim}
              onChange={(e) => setFiltroFim(e.target.value)}
              className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>

          {lancamentosFiltrados.length === 0 ? (
            <EstadoVazio icone={Percent} titulo="Nenhum lançamento de comissão neste filtro." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase text-ink-soft">
                    <th className="py-2 pr-3">Data</th>
                    <th className="py-2 pr-3">Profissional</th>
                    <th className="py-2 pr-3">Serviço</th>
                    <th className="py-2 pr-3">Valor do serviço</th>
                    <th className="py-2 pr-3">Comissão</th>
                    <th className="py-2 pr-3">Profissional</th>
                    <th className="py-2 pr-3">Estabelecimento</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lancamentosFiltrados.map((l) => (
                    <tr key={l.id} className="border-b border-border/60">
                      <td className="py-2 pr-3">{formatarData(l.dataAtendimento)}</td>
                      <td className="py-2 pr-3">{profissionalPorId.get(l.profissionalId)?.nome ?? "—"}</td>
                      <td className="py-2 pr-3">{servicoPorId.get(l.servicoId)?.nome ?? "—"}</td>
                      <td className="py-2 pr-3">{formatarMoeda(l.precoAgendamentoCentavos)}</td>
                      <td className="py-2 pr-3">
                        {l.tipoComissao === "percentual" ? `${l.valorRegraAplicada}%` : `${formatarMoeda(l.valorRegraAplicada)} fixo`}
                      </td>
                      <td className="py-2 pr-3">{formatarMoeda(l.valorProfissionalCentavos)}</td>
                      <td className="py-2 pr-3">{formatarMoeda(l.valorEstabelecimentoCentavos)}</td>
                      <td className="py-2 pr-3">
                        <Badge cor={l.status === "confirmado" ? "sucesso" : "neutro"}>
                          {l.status === "confirmado" ? "Confirmado" : "Estornado"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid gap-2 border-t border-border pt-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase text-ink-soft">Total dos serviços</p>
              <p className="font-bold text-ink">{formatarMoeda(totais.totalServicosCentavos)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-ink-soft">Total dos profissionais</p>
              <p className="font-bold text-ink">{formatarMoeda(totais.totalProfissionalCentavos)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-ink-soft">Total do estabelecimento</p>
              <p className="font-bold text-ink">{formatarMoeda(totais.totalEstabelecimentoCentavos)}</p>
            </div>
          </div>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}

function LinhaConfiguracaoServico({
  profissionalId,
  servico,
  regra,
  podeGerenciar,
  onSalvar,
  onRemover,
}: {
  profissionalId: string;
  servico: { id: string; nome: string; precoCentavos?: number };
  regra: RegraComissao | undefined;
  podeGerenciar: boolean;
  onSalvar: (profissionalId: string, servicoId: string, tipo: TipoComissao, valor: number) => void;
  onRemover: (regra: RegraComissao) => void;
}) {
  const [tipo, setTipo] = useState<TipoComissao>(regra?.tipo ?? "percentual");
  const [valorTexto, setValorTexto] = useState(
    regra ? (regra.tipo === "percentual" ? String(regra.valor) : (regra.valor / 100).toFixed(2).replace(".", ",")) : ""
  );

  const precoServico = servico.precoCentavos;
  const valorNumerico = tipo === "percentual" ? Number(valorTexto.replace(",", ".")) || 0 : Math.round(parseFloat(valorTexto.replace(",", ".") || "0") * 100);
  const preview =
    precoServico !== undefined ? calcularComissao(precoServico, { tipo, valor: regra ? regra.valor : valorNumerico }) : null;

  return (
    <div className="rounded-[var(--radius-control)] border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{servico.nome}</p>
          <p className="text-sm text-ink-soft">
            Preço: {precoServico !== undefined ? formatarMoeda(precoServico) : "Sob consulta"}
          </p>
        </div>
        {!regra && <Badge cor="neutro">Sem comissão configurada</Badge>}
      </div>

      {podeGerenciar && precoServico !== undefined && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Tipo</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoComissao)}
              className="rounded-[var(--radius-control)] border border-border bg-card px-2 py-1.5 text-sm text-ink"
            >
              <option value="percentual">Percentual</option>
              <option value="fixo">Valor fixo</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">{tipo === "percentual" ? "Percentual (%)" : "Valor (R$)"}</label>
            <input
              type="text"
              inputMode="decimal"
              value={valorTexto}
              onChange={(e) => setValorTexto(e.target.value)}
              className="w-28 rounded-[var(--radius-control)] border border-border bg-card px-2 py-1.5 text-sm text-ink"
            />
          </div>
          <Botao
            tamanho="sm"
            onClick={() => onSalvar(profissionalId, servico.id, tipo, tipo === "percentual" ? valorNumerico : valorNumerico)}
          >
            {regra ? "Salvar" : "Configurar"}
          </Botao>
          {regra && (
            <Botao tamanho="sm" variante="secundaria" onClick={() => onRemover(regra)}>
              Remover
            </Botao>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-[var(--radius-control)] bg-paper-muted p-2.5 text-sm sm:w-72">
        <span className="text-ink-soft">Profissional</span>
        <span className="text-right font-semibold text-ink">{preview ? formatarMoeda(preview.valorProfissionalCentavos) : "—"}</span>
        <span className="text-ink-soft">Estabelecimento</span>
        <span className="text-right font-semibold text-ink">{preview ? formatarMoeda(preview.valorEstabelecimentoCentavos) : "—"}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rodar `npm run lint` e `npm run build`** para pegar qualquer erro de tipo/JSX antes de seguir.

Run: `npm run lint && npm run build`
Expected: sem erros; build lista `/painel/comissoes` como rota nova (21 no total).

---

### Task 6: Retirar `comissoes` de `FEATURES_AINDA_NAO_IMPLEMENTADAS`

**Files:**
- Modify: `src/lib/planos.ts`

**Interfaces:** nenhuma — só dado.

- [ ] **Step 1: Remover `"comissoes"` do array `FEATURES_AINDA_NAO_IMPLEMENTADAS`**, mantendo `DEFINICOES_PLANO` intocado (só o plano `pro` continua com a feature, nenhuma mudança de quem tem o quê):

```typescript
export const FEATURES_AINDA_NAO_IMPLEMENTADAS: readonly Feature[] = [
  "listaDeEspera",
  "pagamentos",
  "assinaturas",
  "dominioProprio",
];
```

- [ ] **Step 2: Rodar suíte inteira, lint, build**

Run: `npm run test && npm run lint && npm run build`
Expected: PASS, 21 rotas, nenhuma regressão nas telas master que leem `FEATURES_AINDA_NAO_IMPLEMENTADAS` (elas só trocam o badge "Em breve" pelo toggle normal — comportamento esperado, não é bug).

---

### Task 7: Verificação final e revisão de escopo

**Files:** nenhum — só leitura/execução.

- [ ] **Step 1:** `npm run test` — Expected: PASS, total = 88 testes (60 originais + 16 engine + 9 repositórios + 3 access-control). Confirmar 20 novos testes cobrindo os 20 itens pedidos (mapeamento: 1-3 e 19 → `engine.test.ts` `calcularComissao`/`calcularTotaisRelatorio`; 4-8 → `engine.test.ts` `validarRegraComissao`; 9-14 e 20 → `repositories/comissoes.test.ts`; 15 → `repositories/comissoes.test.ts` isolamento; 16-18 → `access-control.test.ts`).
- [ ] **Step 2:** `npm run lint` — Expected: 0 erros.
- [ ] **Step 3:** `npm run build` — Expected: sucesso, 21 rotas incluindo `/painel/comissoes`.
- [ ] **Step 4:** `git diff --check` — Expected: sem saída.
- [ ] **Step 5:** `git status --short` — conferir que só os arquivos desta feature aparecem, nada em `prisma/`, `.env*`, `package.json`, `package-lock.json`, `node_modules`, `.next`.
- [ ] **Step 6: Revisão manual dirigida do diff**, confirmando:
  - Nenhuma função de mutação da tela de comissões roda sem checar `podeAcessar("comissoes.gerenciar")` de novo, mesmo com botão escondido.
  - `agendamentoRepository.criar`, `atualizarStatus`, `remarcar` continuam com a mesma assinatura pública — só o corpo interno de `atualizarStatus`/`remarcar` ganhou o gatilho.
  - Nenhum arquivo de Prisma/banco/NestJS/TypeORM/Neon/`.env`/dependências foi tocado.
  - `DEFINICOES_PLANO` não mudou quais planos têm a feature `comissoes`.

---

### Task 8: Commit

**Files:** nenhum novo — só staging dos arquivos criados/modificados nas Tasks 1-6.

- [ ] **Step 1:** `git status --short` — conferir que a lista é exatamente:
  - `docs/plans/mvp-divisao-comissoes.md`
  - `src/lib/types.ts`
  - `src/lib/comissoes/engine.ts`
  - `src/lib/comissoes/engine.test.ts`
  - `src/lib/storage/local-storage.ts`
  - `src/lib/repositories/index.ts`
  - `src/lib/repositories/comissoes.test.ts`
  - `src/lib/seed-data.ts`
  - `src/lib/access/access-control.ts`
  - `src/lib/access/access-control.test.ts`
  - `src/app/painel/layout.tsx`
  - `src/app/painel/comissoes/page.tsx`
  - `src/lib/planos.ts`

  Se aparecer qualquer outro arquivo, PARAR e reportar.

- [ ] **Step 2:** Adicionar explicitamente cada arquivo (nunca `git add -A`).
- [ ] **Step 3:** Conferir `git status --short` de novo — só `A`/`M` nos arquivos listados.
- [ ] **Step 4:** Commit com mensagem `feat: add commission split tracking`.
- [ ] **Step 5:** `git log -1 --format="%h %s"` e `git status --short` para o relatório final. **Não fazer push.**

---

## Critérios de aceitação

- Regra configurável só por `profissional + serviço`, com upsert garantindo unicidade estrutural.
- Cálculo usa `Agendamento.precoCentavos` congelado, nunca o preço atual do serviço; centavos inteiros, arredondamento determinístico testado.
- Sem regra: comissão R$0, estabelecimento 100%, não bloqueia conclusão do atendimento.
- Lançamento criado só ao concluir, exatamente uma vez por agendamento, imutável quanto à regra usada; estorno marca sem apagar.
- Cancelado/falta nunca geram lançamento.
- Permissões `comissoes.visualizar`/`comissoes.gerenciar` funcionam em 3 camadas (rota, menu, mutação) só por estarem mapeadas à feature `comissoes` — sem código duplicado.
- Plano sem a feature bloqueia as 3 camadas automaticamente.
- Nenhum dado existente é apagado ou invalidado; coleções novas semeiam sozinhas.
- 88 testes passando, lint limpo, build com 21 rotas.
- `comissoes` sai de `FEATURES_AINDA_NAO_IMPLEMENTADAS` só depois de tudo funcional, sem mudar quais planos a incluem.
