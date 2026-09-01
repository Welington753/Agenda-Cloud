# Correção de Integridade — Agendamento e Permissões — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagent-driven-development and subagents are explicitly OUT of scope for this plan — execute inline in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir 4 falhas reais de integridade na branch `feat/melhorias-frontend`: cálculo de duração/intervalo na disponibilidade, reconfirmação de disponibilidade antes de gravar, bloqueio de agendamento público para tenant suspenso/cancelado, e separação visualizar/gerenciar nas permissões do painel.

**Architecture:** Todas as correções são frontend/protótipo puro (funções em `src/lib`, componentes React client-side, `localStorage` via `src/lib/repositories`). Nenhuma mudança em Prisma/NestJS/TypeORM/Neon/`.env`/dependências. Regras de negócio ficam em funções puras testáveis (`engine.ts`, `access-control.ts`); componentes só chamam essas funções — nunca duplicam a lógica.

**Tech Stack:** Next.js (App Router, `"use client"`), TypeScript, Vitest, date-fns.

**Spec:** Requisitos definidos diretamente pelo usuário nesta conversa (sem documento externo). HEAD inicial: `fa880fb` na branch `feat/melhorias-frontend`, 50 testes passando, lint limpo, build com 20 rotas.

## Global Constraints

- Não alterar: arquivos Prisma, banco de dados, Neon, NestJS, TypeORM, `.env`, `package.json`, `package-lock.json`, dependências, identidade visual/nome do produto, personalização avançada, relação serviço/profissional, limites dos planos, README.
- Não fazer push, merge, rebase ou troca de branch.
- Não instalar bibliotecas de teste de componentes — só testes de funções puras (Vitest, já configurado).
- `dataHoraFim` de um `Agendamento` sempre representa o fim do atendimento (duração do serviço), nunca soma o intervalo posterior.
- Cancelamento (`status: "cancelado"`) e falta (`status: "nao_compareceu"`) continuam liberando o horário — não alterar `STATUS_OCUPA_AGENDA` em `engine.ts`.
- Regra de status funcional do tenant já existe em `src/lib/access/access-control.ts`: `ativo`, `teste`, `inadimplente` = funcional; `suspenso`, `cancelado` = bloqueado. Reaproveitar essa mesma classificação (não reinventar) para a Correção 3.
- Ao final: `npm run test`, `npm run lint`, `npm run build` devem passar; as 20 rotas do build devem continuar compilando; `git status --short` limpo após o commit final (só os arquivos desta tarefa staged).

---

## Contexto de arquivos já mapeado (não precisa re-explorar)

- `src/lib/availability/engine.ts` — motor puro de disponibilidade. `calcularHorariosDisponiveis(opcoes: OpcoesDisponibilidade): Date[]`. `agendamentosParaOcupados(agendamentos, duracaoPorServicoMinutos, intervaloPosteriorPorServicoMinutos): JanelaOcupada[]`. `STATUS_OCUPA_AGENDA = ["pendente","confirmado","em_atendimento","concluido"]`.
- `src/lib/availability/consulta.ts` — ponte para repositórios. `horariosLivresDoProfissionalNoDia(profissional, servico, dia, estabelecimento, agendamentoIdExcluir?): Date[]`. **Bug:** monta `new Map([[servico.id, servico.duracaoMinutos]])` — só o serviço selecionado, então outros agendamentos caem no fallback `?? 30` dentro de `agendamentosParaOcupados`.
- `src/lib/availability/engine.test.ts` — testes existentes do motor (13 testes, não quebrar).
- `src/lib/types.ts` — `Servico.duracaoMinutos: number`, `Servico.intervaloPosteriorMinutos: number`; `Estabelecimento.status: StatusEstabelecimento` (`"teste"|"ativo"|"suspenso"|"inadimplente"|"cancelado"`); `Permission` (union de strings, ex. `"servicos.gerenciar"`).
- `src/lib/repositories/index.ts` — `servicoRepository.listarPorTenant(tenantId)`, `agendamentoRepository.{criar,atualizarStatus,remarcar}`, `estabelecimentoRepository.obterPorTenantId/obterPorSlug`.
- `src/lib/access/access-control.ts` — `calcularAcessoEfetivo` (já usada por `useTenant().podeAcessar`), `STATUS_TENANT_FUNCIONAL = ["ativo","teste","inadimplente"]`, `featureHabilitada`.
- `src/lib/tenant/tenant-context.tsx` — `useTenant()` expõe `podeAcessar(permissao: Permission): { permitido: boolean; motivo?: string }`. Já funciona por permissão granular — não precisa criar infraestrutura nova, só **usar** em cada mutação.
- `src/components/layout/require-permission.tsx` — guarda de página (já usado corretamente com permissões de "visualizar"). Não mexer.
- Páginas/componentes do painel que hoje só guardam a página e não as mutações: `src/app/painel/servicos/page.tsx`, `src/app/painel/profissionais/page.tsx`, `src/app/painel/agenda/page.tsx`, `src/app/profissional/agenda/page.tsx`, `src/components/painel/modal-agendamento.tsx` (`ModalDetalheAgendamento`).
- Fluxos de criação/remarcação que precisam reconfirmar disponibilidade: `src/app/[slug]/agendar/page.tsx` (**já reconfirma** — reaproveitar como referência), `src/components/painel/modal-novo-agendamento.tsx` (não reconfirma), `src/components/painel/modal-agendamento.tsx` (não reconfirma no botão "Confirmar novo horário"), `src/app/[slug]/agendamento/[id]/page.tsx` (`confirmarRemarcacao` não reconfirma).
- Página pública do estabelecimento: `src/app/[slug]/page.tsx` computa `agendamentoPublicoHabilitado` via `featureHabilitada(...)` e passa para `ModeloClassico`/`ModeloModerno` (`src/components/publico/modelo-classico.tsx`, `modelo-moderno.tsx`), que já escondem o CTA e mostram uma mensagem alternativa quando `agendamentoPublicoHabilitado === false`. **Não precisamos tocar nesses dois componentes** — basta compor a mesma flag em `[slug]/page.tsx` para também considerar o status do tenant.

---

### Task 1: Correção 1 — duração e intervalo posterior no motor de disponibilidade (TDD)

**Files:**
- Modify: `src/lib/availability/engine.ts`
- Modify: `src/lib/availability/consulta.ts`
- Test: `src/lib/availability/engine.test.ts`

**Interfaces:**
- Produces: `OpcoesDisponibilidade.intervaloPosteriorMinutos?: number` (default `0` quando ausente — compatibilidade com chamadas existentes). `agendamentosParaOcupados` mantém a mesma assinatura, só corrige o cálculo do `fim`.
- Consumes: nada de tasks anteriores.

- [ ] **Step 1: Escrever os testes que falham em `engine.test.ts`**

Adicionar ao final do arquivo (antes do fechamento do último `describe`, como um novo `describe`):

```typescript
describe("intervalo posterior e duração real do agendamento existente", () => {
  it("agendamento existente de 90 minutos não vira 30 minutos quando o novo serviço é diferente", () => {
    // Agendamento de OUTRO serviço, das 10:00 às 11:30 (90 min), sem cadastro desse
    // serviço no mapa de durações passado para agendamentosParaOcupados — deve usar
    // dataHoraFim real, não o fallback de 30 min.
    const outroServico: Agendamento = {
      id: "ag-outro",
      tenantId: "t1",
      consumidorId: "c1",
      consumidorNome: "Cliente",
      consumidorWhatsapp: "(11) 90000-0000",
      profissionalId: "p1",
      servicoId: "serv-longo",
      dataHoraInicio: hora("10:00").toISOString(),
      dataHoraFim: hora("11:30").toISOString(),
      status: "confirmado",
      precoCentavos: 5000,
      criadoEm: new Date().toISOString(),
      historico: [],
    };
    // Mapas SEM entrada para "serv-longo" — simula a consulta vendo o agendamento de
    // um serviço que não é o selecionado no momento.
    const ocupados = agendamentosParaOcupados(
      [outroServico],
      new Map([["serv-x", 30]]),
      new Map([["serv-x", 0]])
    );
    expect(ocupados).toHaveLength(1);
    expect(ocupados[0].fim.getTime()).toBe(hora("11:30").getTime());
    expect(ocupados[0].fim.getTime()).not.toBe(hora("10:30").getTime());

    const disponiveis = calcularHorariosDisponiveis(baseOpcoes({ ocupados }));
    // 11:00 estaria livre se o motor tratasse o agendamento como 30 min (fim 10:30);
    // com a duração real (fim 11:30) deve continuar ocupado.
    expect(disponiveis.some((d) => d.getTime() === hora("11:00").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("11:30").getTime())).toBe(true);
  });

  it("intervalo posterior do agendamento existente bloqueia o próximo início", () => {
    const agendamento: Agendamento = {
      id: "ag-1",
      tenantId: "t1",
      consumidorId: "c1",
      consumidorNome: "Cliente",
      consumidorWhatsapp: "(11) 90000-0000",
      profissionalId: "p1",
      servicoId: "serv-x",
      dataHoraInicio: hora("10:00").toISOString(),
      dataHoraFim: hora("10:30").toISOString(),
      status: "confirmado",
      precoCentavos: 4000,
      criadoEm: new Date().toISOString(),
      historico: [],
    };
    const ocupados = agendamentosParaOcupados(
      [agendamento],
      new Map([["serv-x", 30]]),
      new Map([["serv-x", 15]]) // 15 min de intervalo posterior
    );
    expect(ocupados[0].fim.getTime()).toBe(hora("10:45").getTime());

    const disponiveis = calcularHorariosDisponiveis(baseOpcoes({ ocupados }));
    expect(disponiveis.some((d) => d.getTime() === hora("10:30").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("10:45").getTime())).toBe(true);
  });

  it("intervalo posterior do novo serviço impede sobreposição com o próximo compromisso", () => {
    // Já existe um compromisso às 11:00. O novo serviço dura 30 min + 20 min de
    // intervalo posterior — não pode começar às 10:40 (terminaria 11:10, dentro do
    // intervalo, invadindo o próximo compromisso).
    const opcoes = baseOpcoes({
      duracaoServicoMinutos: 30,
      intervaloPosteriorMinutos: 20,
      ocupados: [{ inicio: hora("11:00"), fim: hora("11:30") }],
    });
    const disponiveis = calcularHorariosDisponiveis(opcoes);
    expect(disponiveis.some((d) => d.getTime() === hora("10:40").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("10:10").getTime())).toBe(true);
  });

  it("duração + intervalo do novo serviço precisam caber antes do fechamento", () => {
    const opcoes = baseOpcoes({ duracaoServicoMinutos: 30, intervaloPosteriorMinutos: 20 });
    const disponiveis = calcularHorariosDisponiveis(opcoes);
    // Fecha às 19:00. 18:30 + 30min = 19:00 cabe, mas +20min de intervalo passa do
    // fechamento — não deve aparecer. 18:10 + 30 + 20 = 19:00 exato, deve aparecer.
    expect(disponiveis.some((d) => d.getTime() === hora("18:30").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("18:10").getTime())).toBe(true);
  });

  it("cancelamento continua liberando o horário mesmo com intervalo posterior cadastrado", () => {
    const cancelado: Agendamento = {
      id: "ag-c",
      tenantId: "t1",
      consumidorId: "c1",
      consumidorNome: "Cliente",
      consumidorWhatsapp: "(11) 90000-0000",
      profissionalId: "p1",
      servicoId: "serv-x",
      dataHoraInicio: hora("10:00").toISOString(),
      dataHoraFim: hora("10:30").toISOString(),
      status: "cancelado",
      precoCentavos: 4000,
      criadoEm: new Date().toISOString(),
      historico: [],
    };
    const ocupados = agendamentosParaOcupados([cancelado], new Map([["serv-x", 30]]), new Map([["serv-x", 15]]));
    expect(ocupados).toHaveLength(0);
    const disponiveis = calcularHorariosDisponiveis(baseOpcoes({ ocupados }));
    expect(disponiveis.some((d) => d.getTime() === hora("10:00").getTime())).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- engine.test.ts`
Expected: as 5 novas asserções falham (a 1ª e a 5ª por causa do fallback de 30 min em `agendamentosParaOcupados`; a 2ª/3ª/4ª por falta de `intervaloPosteriorMinutos` em `calcularHorariosDisponiveis`).

- [ ] **Step 3: Corrigir `agendamentosParaOcupados` em `engine.ts` para usar `dataHoraFim` real**

Em `src/lib/availability/engine.ts`, substituir a função (linhas 57-72):

```typescript
/** Converte agendamentos em janelas ocupadas. Usa `dataHoraFim` como fim real do
 * atendimento (não recalcula a duração); só recai no fallback pela duração
 * cadastrada do serviço se `dataHoraFim` estiver ausente/inválido/não-posterior ao
 * início, protegendo dados malformados sem alterar o significado de `dataHoraFim`
 * para os dados válidos. Some o intervalo posterior do serviço depois do fim real.
 * Agendamentos cancelados ou com falta não geram janela. */
export function agendamentosParaOcupados(
  agendamentos: Agendamento[],
  duracaoPorServicoMinutos: Map<string, number>,
  intervaloPosteriorPorServicoMinutos: Map<string, number>
): JanelaOcupada[] {
  return agendamentos
    .filter((a) => STATUS_OCUPA_AGENDA.includes(a.status))
    .map((a) => {
      const inicio = new Date(a.dataHoraInicio);
      const fimRegistrado = new Date(a.dataHoraFim);
      const intervalo = intervaloPosteriorPorServicoMinutos.get(a.servicoId) ?? 0;
      const fimRegistradoValido = !Number.isNaN(fimRegistrado.getTime()) && isBefore(inicio, fimRegistrado);
      const fimReal = fimRegistradoValido
        ? fimRegistrado
        : addMinutes(inicio, duracaoPorServicoMinutos.get(a.servicoId) ?? 30);
      return { inicio, fim: addMinutes(fimReal, intervalo) };
    });
}
```

- [ ] **Step 4: Adicionar `intervaloPosteriorMinutos` a `OpcoesDisponibilidade` e usá-lo em `calcularHorariosDisponiveis`**

Em `src/lib/availability/engine.ts`, na interface (linhas 12-21), adicionar o campo:

```typescript
export interface OpcoesDisponibilidade {
  data: Date;
  horarios: HorarioDia[];
  duracaoServicoMinutos: number;
  /** Intervalo posterior do serviço sendo agendado agora — reserva esse tempo
   * depois do atendimento antes de liberar o próximo horário. Padrão 0 mantém
   * compatibilidade com chamadas existentes. */
  intervaloPosteriorMinutos?: number;
  ocupados: JanelaOcupada[];
  antecedenciaMinimaMinutos: number;
  limiteDiasFuturos: number;
  agora?: Date;
  passoMinutos?: number;
}
```

Depois, em `calcularHorariosDisponiveis` (linhas 80-110), trocar o corpo do laço para considerar `duracao + intervalo` na checagem de expediente/almoço/conflito, mantendo `fimServico` puro (só a duração) para uso futuro se necessário:

```typescript
export function calcularHorariosDisponiveis(opcoes: OpcoesDisponibilidade): Date[] {
  const passo = opcoes.passoMinutos ?? 15;
  const intervaloPosterior = opcoes.intervaloPosteriorMinutos ?? 0;
  const horarioDia = obterHorarioDoDia(opcoes.horarios, getDay(opcoes.data) as DiaSemana);
  if (!horarioDia) return [];

  const agora = opcoes.agora ?? new Date();
  const limiteMaximo = addMinutes(startOfDay(agora), opcoes.limiteDiasFuturos * 24 * 60);
  if (isBefore(limiteMaximo, startOfDay(opcoes.data))) return [];

  const aberturaDia = horaParaDate(opcoes.data, horarioDia.inicio);
  const fechamentoDia = horaParaDate(opcoes.data, horarioDia.fim);
  const almocoInicio = horarioDia.almocoInicio ? horaParaDate(opcoes.data, horarioDia.almocoInicio) : null;
  const almocoFim = horarioDia.almocoFim ? horaParaDate(opcoes.data, horarioDia.almocoFim) : null;
  const inicioMinimoPorAntecedencia = addMinutes(agora, opcoes.antecedenciaMinimaMinutos);

  const disponiveis: Date[] = [];
  let cursor = aberturaDia;
  while (isBefore(cursor, fechamentoDia)) {
    const fimServico = addMinutes(cursor, opcoes.duracaoServicoMinutos);
    const fimComIntervalo = addMinutes(fimServico, intervaloPosterior);
    const cabeNoExpediente = !isBefore(fechamentoDia, fimComIntervalo);
    const cruzaAlmoco =
      almocoInicio && almocoFim ? intervalosSeSobrepoem(cursor, fimComIntervalo, almocoInicio, almocoFim) : false;
    const respeitaAntecedencia = !isBefore(cursor, inicioMinimoPorAntecedencia);
    const temConflito = opcoes.ocupados.some((o) => intervalosSeSobrepoem(cursor, fimComIntervalo, o.inicio, o.fim));

    if (cabeNoExpediente && !cruzaAlmoco && respeitaAntecedencia && !temConflito) {
      disponiveis.push(cursor);
    }
    cursor = addMinutes(cursor, passo);
  }
  return disponiveis;
}
```

- [ ] **Step 5: Corrigir `consulta.ts` para conhecer todos os serviços do tenant**

Em `src/lib/availability/consulta.ts`, importar `servicoRepository` e montar os mapas completos:

```typescript
import { agendamentosParaOcupados, bloqueiosParaOcupados, calcularHorariosDisponiveis } from "./engine";
import { agendamentoRepository, bloqueioRepository, servicoRepository } from "@/lib/repositories";
import type { Estabelecimento, Profissional, Servico } from "@/lib/types";

export function horariosLivresDoProfissionalNoDia(
  profissional: Profissional,
  servico: Servico,
  dia: Date,
  estabelecimento: Estabelecimento,
  agendamentoIdExcluir?: string
): Date[] {
  const servicosTenant = servicoRepository.listarPorTenant(estabelecimento.tenantId);
  const duracaoPorServico = new Map(servicosTenant.map((s) => [s.id, s.duracaoMinutos]));
  const intervaloPorServico = new Map(servicosTenant.map((s) => [s.id, s.intervaloPosteriorMinutos]));
  // Garante entrada mesmo se o serviço em uso não estiver na listagem padrão do tenant
  // (ex.: serviço ocultado do agendamento público, mas ainda válido para este cálculo).
  duracaoPorServico.set(servico.id, servico.duracaoMinutos);
  intervaloPorServico.set(servico.id, servico.intervaloPosteriorMinutos);

  const agendamentosProf = agendamentoRepository
    .listarPorProfissional(profissional.id)
    .filter((a) => a.tenantId === estabelecimento.tenantId && a.id !== agendamentoIdExcluir);
  const bloqueiosProf = bloqueioRepository.listarPorProfissional(profissional.id);
  const ocupados = [
    ...agendamentosParaOcupados(agendamentosProf, duracaoPorServico, intervaloPorServico),
    ...bloqueiosParaOcupados(bloqueiosProf),
  ];
  return calcularHorariosDisponiveis({
    data: dia,
    horarios: profissional.horarios,
    duracaoServicoMinutos: servico.duracaoMinutos,
    intervaloPosteriorMinutos: servico.intervaloPosteriorMinutos,
    ocupados,
    antecedenciaMinimaMinutos: estabelecimento.regras.antecedenciaMinimaMinutos,
    limiteDiasFuturos: estabelecimento.regras.limiteDiasFuturos,
  });
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam, sem quebrar os 13 testes antigos**

Run: `npm run test -- engine.test.ts`
Expected: PASS (18 testes no arquivo: 13 antigos + 5 novos).

- [ ] **Step 7: Rodar a suíte inteira para garantir que nada mais quebrou**

Run: `npm run test`
Expected: PASS, total de testes = 55 (50 originais + 5 novos).

- [ ] **Step 8: Commit** (fica para o commit único no final da Task 6 — não commitar agora)

---

### Task 2: Correção 2 — reconfirmação de disponibilidade antes de gravar

**Files:**
- Modify: `src/lib/availability/consulta.ts`
- Modify: `src/app/[slug]/agendar/page.tsx`
- Modify: `src/components/painel/modal-novo-agendamento.tsx`
- Modify: `src/components/painel/modal-agendamento.tsx`
- Modify: `src/app/painel/agenda/page.tsx`
- Modify: `src/app/profissional/agenda/page.tsx`
- Modify: `src/app/[slug]/agendamento/[id]/page.tsx`

**Interfaces:**
- Consumes: `horariosLivresDoProfissionalNoDia` de `consulta.ts` (Task 1, assinatura inalterada).
- Produces: `horarioAindaDisponivelParaProfissional(profissional, servico, horario, estabelecimento, agendamentoIdExcluir?): boolean`, exportado de `src/lib/availability/consulta.ts` — usado por todos os fluxos abaixo em vez de cada um recalcular a checagem manualmente.

- [ ] **Step 1: Adicionar o helper central em `consulta.ts`**

Ao final de `src/lib/availability/consulta.ts`, adicionar:

```typescript
/** Reconfirma, imediatamente antes de gravar, que um horário específico ainda está
 * livre para este profissional — mesma regra central usada para listar horários,
 * nunca uma checagem paralela. Usar em TODO fluxo de criação/remarcação (público,
 * painel, agenda do profissional) para proteger contra a janela de tempo entre a
 * listagem de horários e a confirmação. */
export function horarioAindaDisponivelParaProfissional(
  profissional: Profissional,
  servico: Servico,
  horario: Date,
  estabelecimento: Estabelecimento,
  agendamentoIdExcluir?: string
): boolean {
  return horariosLivresDoProfissionalNoDia(profissional, servico, horario, estabelecimento, agendamentoIdExcluir).some(
    (h) => h.getTime() === horario.getTime()
  );
}
```

- [ ] **Step 2: Reaproveitar o helper no agendamento público (já reconfirmava, agora usando a função central)**

Em `src/app/[slug]/agendar/page.tsx`, trocar o import (linha 8):

```typescript
import { horarioAindaDisponivelParaProfissional } from "@/lib/availability/consulta";
```

E dentro de `confirmarAgendamento` (linhas 189-209), substituir o bloco de checagem:

```typescript
async function confirmarAgendamento() {
  if (!servico || !horarioSelecionado || !profissionalResolvidoId) return;
  setEnviando(true);
  const profissional = profissionaisCapacitados.find((p) => p.id === profissionalResolvidoId);
  if (!profissional) {
    notificar("Não foi possível confirmar: profissional indisponível.", "erro");
    setEnviando(false);
    return;
  }

  const aindaDisponivel = horarioAindaDisponivelParaProfissional(profissional, servico, horarioSelecionado, estabelecimento);

  if (!aindaDisponivel) {
    notificar("Esse horário acabou de ser preenchido. Escolha outro, por favor.", "erro");
    setEnviando(false);
    setHorarioSelecionado(null);
    setEtapa(2);
    return;
  }
  // ... resto do corpo permanece igual (consumidorRepository.obterOuCriarPorWhatsapp em diante)
```

(Remover a chamada direta a `horariosLivresDoProfissionalNoDia(...).some(...)` que existia antes; o import de `horariosLivresDoProfissionalNoDia` pode ser removido de `agendar/page.tsx` **só se** não for mais usado em outro ponto do arquivo — ele ainda é usado em `calcularHorariosDoProfissional`, então mantenha os dois imports.)

- [ ] **Step 3: Reconfirmar em `modal-novo-agendamento.tsx` (criação manual pelo painel)**

Em `src/components/painel/modal-novo-agendamento.tsx`:
1. Trocar o import (linha 8): `import { horarioAindaDisponivelParaProfissional, horariosLivresDoProfissionalNoDia } from "@/lib/availability/consulta";`
2. Adicionar um contador de "versão" para forçar o recálculo de `horarios` após uma falha de reconfirmação (linha ~39, junto aos outros `useState`):

```typescript
const [versaoHorarios, setVersaoHorarios] = useState(0);
```

3. Incluir `versaoHorarios` nas dependências do `useMemo` de `horarios` (linha 57-60):

```typescript
const horarios = useMemo(() => {
  if (!servico || !profissional) return [];
  return horariosLivresDoProfissionalNoDia(profissional, servico, dia, estabelecimento);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [servico, profissional, dia, estabelecimento, versaoHorarios]);
```

4. No `useEffect` de reset (linha 43-51), zerar também `versaoHorarios`:

```typescript
useEffect(() => {
  if (aberto) {
    setServicoId("");
    setProfissionalId(profissionalPreSelecionadoId ?? "");
    setHorario(null);
    setNome("");
    setWhatsapp("");
    setVersaoHorarios(0);
  }
}, [aberto, profissionalPreSelecionadoId]);
```

5. Reconfirmar em `confirmar()` (linhas 62-85), antes de criar:

```typescript
function confirmar() {
  if (!servico || !profissional || !horario) return;
  if (!nome.trim() || whatsapp.replace(/\D/g, "").length < 10) {
    notificar("Preencha nome e WhatsApp válidos.", "erro");
    return;
  }
  if (!horarioAindaDisponivelParaProfissional(profissional, servico, horario, estabelecimento)) {
    notificar("Esse horário deixou de estar disponível. Escolha outro horário.", "erro");
    setHorario(null);
    setVersaoHorarios((v) => v + 1);
    return;
  }
  const consumidor = consumidorRepository.obterOuCriarPorWhatsapp(estabelecimento.tenantId, nome.trim(), whatsapp);
  const fim = new Date(horario.getTime() + servico.duracaoMinutos * 60_000);
  agendamentoRepository.criar({
    tenantId: estabelecimento.tenantId,
    consumidorId: consumidor.id,
    consumidorNome: nome.trim(),
    consumidorWhatsapp: whatsapp,
    profissionalId: profissional.id,
    servicoId: servico.id,
    dataHoraInicio: horario.toISOString(),
    dataHoraFim: fim.toISOString(),
    status: "confirmado",
    precoCentavos: servico.precoCentavos,
  });
  notificar("Agendamento criado com sucesso.", "sucesso");
  onCriado();
  aoFechar();
}
```

- [ ] **Step 4: Reconfirmar em `modal-agendamento.tsx` (remarcação pelo painel e pela agenda do profissional)**

Em `src/components/painel/modal-agendamento.tsx`:
1. Trocar o import (linha 8): `import { horarioAindaDisponivelParaProfissional, horariosLivresDoProfissionalNoDia } from "@/lib/availability/consulta";`
2. Adicionar import de toast: `import { useToast } from "@/components/ui/toast";`
3. No corpo do componente, adicionar `const { notificar } = useToast();` e `const [versaoHorarios, setVersaoHorarios] = useState(0);` junto aos `useState` existentes (linha 41-42).
4. Incluir `versaoHorarios` nas dependências do `useMemo` de `horariosDoMesmoDia` (linhas 44-53):

```typescript
const horariosDoMesmoDia = useMemo(() => {
  if (!remarcando) return [];
  return horariosLivresDoProfissionalNoDia(
    profissional,
    servico,
    new Date(agendamento.dataHoraInicio),
    estabelecimento,
    agendamento.id
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [remarcando, profissional, servico, agendamento, estabelecimento, versaoHorarios]);
```

5. No botão "Confirmar novo horário" (linhas 128-140), reconfirmar antes de chamar `onRemarcar`:

```tsx
<Botao
  className="flex-1"
  disabled={!novoHorario}
  onClick={() => {
    if (!novoHorario) return;
    if (!horarioAindaDisponivelParaProfissional(profissional, servico, novoHorario, estabelecimento, agendamento.id)) {
      notificar("Esse horário deixou de estar disponível. Escolha outro horário.", "erro");
      setNovoHorario(null);
      setVersaoHorarios((v) => v + 1);
      return;
    }
    onRemarcar(novoHorario);
    fecharTudo();
  }}
>
  Confirmar novo horário
</Botao>
```

- [ ] **Step 5: Reconfirmar na remarcação pública (`[slug]/agendamento/[id]/page.tsx`)**

Em `src/app/[slug]/agendamento/[id]/page.tsx`:
1. Trocar o import (linha 8): `import { horarioAindaDisponivelParaProfissional, horariosLivresDoProfissionalNoDia } from "@/lib/availability/consulta";`
2. Em `confirmarRemarcacao` (linhas 115-124), reconfirmar antes de gravar:

```typescript
function confirmarRemarcacao() {
  if (!horarioRemarcar || !servico) return;
  if (!horarioAindaDisponivelParaProfissional(profissional, servico, horarioRemarcar, estabelecimento, agendamento.id)) {
    notificar("Esse horário deixou de estar disponível. Escolha outro horário.", "erro");
    setHorarioRemarcar(null);
    recarregar();
    return;
  }
  const novoFim = new Date(horarioRemarcar.getTime() + servico.duracaoMinutos * 60_000);
  agendamentoRepository.remarcar(agendamento.id, horarioRemarcar.toISOString(), novoFim.toISOString(), "cliente");
  notificar(`${terminologia.agendamento.singular} remarcado com sucesso.`, "sucesso");
  setRemarcando(false);
  setDataRemarcar(null);
  setHorarioRemarcar(null);
  recarregar();
}
```

Note: `recarregar()` já existe nesse componente (vem de `useClientData`) e força o recálculo de `horariosDisponiveis`, que depende de `dados` — mantém o usuário na tela de remarcação (`remarcando` continua `true`) escolhendo outro horário.

- [ ] **Step 6: Verificar visualmente que `painel/agenda/page.tsx` e `profissional/agenda/page.tsx` não precisam de mudança nesta task**

Essas duas páginas só passam `onRemarcar`/`onMudarStatus` como callbacks para `ModalDetalheAgendamento` — a reconfirmação já foi movida para dentro do modal no Step 4. Nenhuma mudança extra aqui além do que a Task 4 (permissões) vai adicionar.

- [ ] **Step 7: Rodar a suíte de testes e o lint**

Run: `npm run test && npm run lint`
Expected: PASS (nenhum teste novo de componente — a reconfirmação em si já está coberta pelas funções puras testadas na Task 1; aqui é revisão estática cuidadosa do uso, conforme pedido no escopo).

---

### Task 3: Correção 3 — status do tenant no agendamento público

**Files:**
- Modify: `src/lib/access/access-control.ts`
- Test: `src/lib/access/access-control.test.ts`
- Modify: `src/app/[slug]/page.tsx`
- Modify: `src/app/[slug]/agendar/page.tsx`
- Modify: `src/app/[slug]/agendamento/[id]/page.tsx`

**Interfaces:**
- Produces: `podeReceberAgendamentoPublico(status: StatusEstabelecimento): boolean`, exportado de `src/lib/access/access-control.ts`.
- Consumes: `StatusEstabelecimento` de `src/lib/types.ts` (já existe).

- [ ] **Step 1: Escrever os testes que falham em `access-control.test.ts`**

Adicionar ao arquivo (novo `describe`, no final):

```typescript
describe("podeReceberAgendamentoPublico", () => {
  it("permite quando o tenant está ativo", () => {
    expect(podeReceberAgendamentoPublico("ativo")).toBe(true);
  });
  it("permite quando o tenant está em teste", () => {
    expect(podeReceberAgendamentoPublico("teste")).toBe(true);
  });
  it("permite quando o tenant está inadimplente (regra funcional atual)", () => {
    expect(podeReceberAgendamentoPublico("inadimplente")).toBe(true);
  });
  it("bloqueia quando o tenant está suspenso", () => {
    expect(podeReceberAgendamentoPublico("suspenso")).toBe(false);
  });
  it("bloqueia quando o tenant está cancelado", () => {
    expect(podeReceberAgendamentoPublico("cancelado")).toBe(false);
  });
});
```

E no topo do arquivo, garantir que `podeReceberAgendamentoPublico` está no import de `access-control.ts` (ajustar a linha de import existente para incluir o novo nome).

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- access-control.test.ts`
Expected: FAIL com "podeReceberAgendamentoPublico is not a function" (ou erro de import).

- [ ] **Step 3: Implementar a função em `access-control.ts`**

Adicionar, logo depois de `STATUS_TENANT_FUNCIONAL` (linha 115):

```typescript
/** Estabelecimentos "suspenso" ou "cancelado" não podem receber NOVOS agendamentos
 * públicos nem remarcações — reaproveita a mesma classificação de status funcional
 * usada pelo portal (STATUS_TENANT_FUNCIONAL), então as duas regras nunca divergem. */
export function podeReceberAgendamentoPublico(status: StatusEstabelecimento): boolean {
  return STATUS_TENANT_FUNCIONAL.includes(status);
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- access-control.test.ts`
Expected: PASS.

- [ ] **Step 5: Aplicar na página pública do estabelecimento — remover CTA quando bloqueado**

Em `src/app/[slug]/page.tsx`:
1. Trocar o import (linha 9): `import { featureHabilitada, podeReceberAgendamentoPublico } from "@/lib/access/access-control";`
2. Trocar o cálculo de `agendamentoPublicoHabilitado` (linhas 63-67):

```typescript
const agendamentoPublicoHabilitado =
  featureHabilitada(estabelecimento.plano, estabelecimento.featuresDesativadas, "agendamentoPublico") &&
  podeReceberAgendamentoPublico(estabelecimento.status);
```

`ModeloClassico`/`ModeloModerno` já escondem o CTA e mostram a mensagem alternativa quando essa flag é `false` — nenhuma mudança nesses dois componentes.

- [ ] **Step 6: Aplicar na rota `/[slug]/agendar` — impedir completamente a criação**

Em `src/app/[slug]/agendar/page.tsx`:
1. Trocar o import (linha 28): `import { featureHabilitada, podeReceberAgendamentoPublico } from "@/lib/access/access-control";`
2. Logo após o bloco `if (!featureHabilitada(...))` existente (linhas 148-165), adicionar um segundo bloco de bloqueio total:

```tsx
if (!podeReceberAgendamentoPublico(estabelecimento.status)) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
      <EstadoVazio
        icone={Store}
        titulo="Agendamento indisponível"
        descricao={`${estabelecimento.identidadeVisual.nome} não está aceitando novos agendamentos no momento.`}
        acao={
          <Link href={`/${slug}`}>
            <Botao variante="secundaria" tamanho="sm">
              Voltar
            </Botao>
          </Link>
        }
      />
    </div>
  );
}
```

Isso bloqueia toda a rota antes de qualquer etapa do wizard renderizar — nenhuma mutação de criação é alcançável manipulando a interface, porque o componente inteiro retorna cedo.

- [ ] **Step 7: Aplicar na remarcação pública — bloquear remarcação, manter cancelamento e visualização**

Em `src/app/[slug]/agendamento/[id]/page.tsx`:
1. Trocar o import (linha 21 — junto ao import de tipos) e adicionar o novo import de `access-control.ts`:

```typescript
import { podeReceberAgendamentoPublico } from "@/lib/access/access-control";
```

2. Ajustar o cálculo de `podeRemarcar` (linha 106):

```typescript
const podeRemarcar =
  dentroDoPrazo && estabelecimento.regras.permitirRemarcacaoCliente && podeReceberAgendamentoPublico(estabelecimento.status);
```

`podeCancelar` permanece inalterado (cancelamento continua disponível dentro do prazo, mesmo com tenant suspenso/cancelado — conforme o escopo pedido). O detalhe do agendamento (bloco `<Cartao>` com os dados) também permanece sempre visível.

- [ ] **Step 8: Rodar testes, lint**

Run: `npm run test && npm run lint`
Expected: PASS.

---

### Task 4: Correção 4 — permissões de visualização versus alteração

**Files:**
- Modify: `src/app/painel/servicos/page.tsx`
- Modify: `src/app/painel/profissionais/page.tsx`
- Modify: `src/app/painel/agenda/page.tsx`
- Modify: `src/app/profissional/agenda/page.tsx`
- Modify: `src/components/painel/modal-agendamento.tsx`

**Interfaces:**
- Consumes: `useTenant().podeAcessar(permissao: Permission): { permitido: boolean; motivo?: string }` (já existe em `src/lib/tenant/tenant-context.tsx`, nenhuma mudança nela).
- Produces: `ModalDetalheAgendamento` passa a aceitar três props novas de permissão: `podeEditar: boolean`, `podeCancelar: boolean`, `podeGerenciarAgenda: boolean` (usadas para esconder botões — a checagem de verdade continua nos callbacks do componente pai, que já recebem `podeAcessar` via closure).

- [ ] **Step 1: Serviços — esconder e bloquear mutações sem `servicos.gerenciar`**

Em `src/app/painel/servicos/page.tsx`:
1. Adicionar `podeAcessar` à desestruturação de `useTenant()` (linha 28): `const { tenantId, terminologia, estabelecimento, podeAcessar } = useTenant();`
2. Guardar `remover()` com retorno antecipado (linhas 49-54):

```typescript
function remover(servico: Servico) {
  if (!podeAcessar("servicos.gerenciar").permitido) return;
  if (!window.confirm(`Remover "${servico.nome}"? Essa ação não pode ser desfeita.`)) return;
  servicoRepository.remover(servico.id);
  notificar(`${terminologia.servico.singular} removido.`, "sucesso");
  recarregar();
}
```

3. Calcular a flag antes do `return` do JSX (logo depois de `const { servicos, profissionais } = dados;`, linha 47):

```typescript
const podeGerenciar = podeAcessar("servicos.gerenciar").permitido;
```

4. Esconder o botão "Novo serviço" (linhas 63-71) — envolver em `{podeGerenciar && (...)}`:

```tsx
{podeGerenciar && (
  <Botao
    tamanho="sm"
    onClick={() => {
      setEmEdicao(null);
      setModalAberto(true);
    }}
  >
    <Plus size={16} className="mr-1.5" /> Nov{terminologia.servico.artigo === "a" ? "a" : "o"} {terminologia.servico.singular.toLowerCase()}
  </Botao>
)}
```

5. Esconder os botões "Editar"/remover de cada card (linhas 103-118) — envolver o `<div className="flex gap-2">` em `{podeGerenciar && (...)}`:

```tsx
{podeGerenciar && (
  <div className="flex gap-2">
    <Botao
      tamanho="sm"
      variante="secundaria"
      className="flex-1"
      onClick={() => {
        setEmEdicao(servico);
        setModalAberto(true);
      }}
    >
      <Pencil size={14} className="mr-1.5" /> Editar
    </Botao>
    <Botao tamanho="sm" variante="secundaria" onClick={() => remover(servico)}>
      <Trash2 size={14} />
    </Botao>
  </div>
)}
```

6. `ModalServico` só abre a partir desses botões escondidos, mas como defesa em profundidade, abrir o arquivo `src/components/painel/modal-servico.tsx`, localizar a função que salva (criar/editar) e adicionar `if (!podeAcessar("servicos.gerenciar").permitido) return;` como primeira linha — **passar `podeAcessar` como prop nova** `podeAcessar: (p: Permission) => { permitido: boolean }` do componente pai para `ModalServico`, e usá-la lá. Se `modal-servico.tsx` já recebe `tenantId` como prop direta, adicionar `podeAcessar` do mesmo jeito, e repassar `podeAcessar={podeAcessar}` no JSX de `ModalServico` em `painel/servicos/page.tsx` (linha ~125-134).

- [ ] **Step 2: Profissionais — esconder e bloquear mutações sem `profissionais.gerenciar`**

Em `src/app/painel/profissionais/page.tsx`, aplicar o mesmo padrão do Step 1:
1. `const { tenantId, terminologia, podeAcessar } = useTenant();` (linha 27).
2. `const podeGerenciar = podeAcessar("profissionais.gerenciar").permitido;` logo após `const { profissionais, servicos } = dados;` (linha 46).
3. Guardar `alternarAtivo()`:

```typescript
function alternarAtivo(prof: Profissional) {
  if (!podeAcessar("profissionais.gerenciar").permitido) return;
  profissionalRepository.atualizar(prof.id, { ativo: !prof.ativo });
  notificar(
    prof.ativo ? `${terminologia.profissional.singular} desativado(a).` : `${terminologia.profissional.singular} reativado(a).`,
    "sucesso"
  );
  recarregar();
}
```

4. Envolver o botão "Novo profissional" (linhas 65-73) em `{podeGerenciar && (...)}`.
5. Envolver o bloco `<div className="flex gap-2">` com "Editar"/"Desativar" (linhas 110-125) em `{podeGerenciar && (...)}`.
6. Como no Step 1, adicionar guarda equivalente na função de salvar de `src/components/painel/modal-profissional.tsx` (repassar `podeAcessar` como prop, checar `profissionais.gerenciar` antes de criar/editar/ativar/desativar).

- [ ] **Step 3: Adicionar props de permissão em `ModalDetalheAgendamento`**

Em `src/components/painel/modal-agendamento.tsx`, ajustar a interface e a assinatura do componente (linhas 18-40):

```typescript
interface ModalDetalheAgendamentoProps {
  aberto: boolean;
  aoFechar: () => void;
  agendamento: Agendamento;
  servico: Servico;
  profissional: Profissional;
  estabelecimento: Estabelecimento;
  terminologia: Terminologia;
  podeEditar: boolean;
  podeCancelar: boolean;
  onMudarStatus: (status: StatusAgendamento) => void;
  onRemarcar: (novoInicio: Date) => void;
}

export function ModalDetalheAgendamento({
  aberto,
  aoFechar,
  agendamento,
  servico,
  profissional,
  estabelecimento,
  terminologia,
  podeEditar,
  podeCancelar,
  onMudarStatus,
  onRemarcar,
}: ModalDetalheAgendamentoProps) {
```

Ajustar `podeAlterar` (linha 56) para também exigir `podeEditar` para as ações de progressão/remarcar/falta, e usar `podeCancelar` separadamente no botão de cancelar (linhas 121-164):

```typescript
const acaoPrincipal = PROXIMO_STATUS[agendamento.status];
const statusPermiteAlterar = agendamento.status !== "concluido" && agendamento.status !== "cancelado";
const podeAlterar = statusPermiteAlterar && podeEditar;
const podeCancelarAgora = statusPermiteAlterar && podeCancelar;
```

```tsx
{(podeAlterar || podeCancelarAgora) && (
  <div className="mt-5 space-y-2">
    {remarcando ? (
      <div className="flex gap-2">
        <Botao variante="secundaria" className="flex-1" onClick={() => setRemarcando(false)}>
          Voltar
        </Botao>
        <Botao
          className="flex-1"
          disabled={!novoHorario}
          onClick={() => {
            if (!novoHorario) return;
            if (!horarioAindaDisponivelParaProfissional(profissional, servico, novoHorario, estabelecimento, agendamento.id)) {
              notificar("Esse horário deixou de estar disponível. Escolha outro horário.", "erro");
              setNovoHorario(null);
              setVersaoHorarios((v) => v + 1);
              return;
            }
            onRemarcar(novoHorario);
            fecharTudo();
          }}
        >
          Confirmar novo horário
        </Botao>
      </div>
    ) : (
      <>
        {podeAlterar && acaoPrincipal && (
          <Botao className="w-full" onClick={() => onMudarStatus(acaoPrincipal.status)}>
            {acaoPrincipal.rotulo}
          </Botao>
        )}
        {podeAlterar && (
          <div className="flex gap-2">
            <Botao variante="secundaria" className="flex-1" onClick={() => setRemarcando(true)}>
              Remarcar
            </Botao>
            {agendamento.status !== "nao_compareceu" && (
              <Botao variante="secundaria" className="flex-1" onClick={() => onMudarStatus("nao_compareceu")}>
                Marcar falta
              </Botao>
            )}
          </div>
        )}
        {podeCancelarAgora && (
          <Botao variante="perigo" className="w-full" onClick={() => onMudarStatus("cancelado")}>
            Cancelar {terminologia.agendamento.singular.toLowerCase()}
          </Botao>
        )}
      </>
    )}
  </div>
)}
```

(O bloco `{remarcando && (...)}` que lista `horariosDoMesmoDia`, mais acima no JSX, permanece igual — só é alcançável se `podeAlterar` já liberou o botão "Remarcar".)

- [ ] **Step 4: Passar as props de permissão e guardar os callbacks em `painel/agenda/page.tsx`**

Em `src/app/painel/agenda/page.tsx`:
1. Adicionar `podeAcessar` à desestruturação de `useTenant()` (linha 49): `const { tenantId, terminologia, podeAcessar } = useTenant();`
2. No botão "Novo agendamento" por profissional (linhas 242-249) — envolver em `{podeAcessar("agendamento.criar").permitido && (...)}`.
3. No botão "Bloquear horário" (linhas 250-257) — envolver em `{podeAcessar("agenda.gerenciar").permitido && (...)}`.
4. No botão "Remover" de bloqueio (linhas 276-285) — guardar o `onClick`:

```tsx
<button
  type="button"
  onClick={() => {
    if (!podeAcessar("agenda.gerenciar").permitido) return;
    bloqueioRepository.remover(b.id);
    recarregar();
  }}
  className="shrink-0 text-xs font-semibold text-[color:var(--color-danger)] hover:underline"
>
  Remover
</button>
```

Também envolver esse `<button>` inteiro em `{podeAcessar("agenda.gerenciar").permitido && (...)}` para escondê-lo (defesa dupla: esconder E guardar).

5. No `ModalDetalheAgendamento` (linhas 327-347), passar as novas props e guardar os callbacks:

```tsx
<ModalDetalheAgendamento
  aberto={Boolean(agendamentoSelecionado)}
  aoFechar={() => setAgendamentoSelecionado(null)}
  agendamento={agendamentoSelecionado}
  servico={servico}
  profissional={profissional}
  estabelecimento={estabelecimento}
  terminologia={terminologia}
  podeEditar={podeAcessar("agendamento.editar").permitido}
  podeCancelar={podeAcessar("agendamento.cancelar").permitido}
  onMudarStatus={(status) => {
    const permissaoNecessaria = status === "cancelado" ? "agendamento.cancelar" : "agendamento.editar";
    if (!podeAcessar(permissaoNecessaria).permitido) return;
    agendamentoRepository.atualizarStatus(agendamentoSelecionado.id, status, "dono");
    recarregar();
    setAgendamentoSelecionado(null);
  }}
  onRemarcar={(novoInicio) => {
    if (!podeAcessar("agendamento.editar").permitido) return;
    const fim = new Date(novoInicio.getTime() + servico.duracaoMinutos * 60_000);
    agendamentoRepository.remarcar(agendamentoSelecionado.id, novoInicio.toISOString(), fim.toISOString(), "dono");
    recarregar();
    setAgendamentoSelecionado(null);
  }}
/>
```

6. No `ModalNovoAgendamento` (linhas 350-362) e `ModalBloqueio` (linhas 364-375), só renderizar quando a permissão correspondente é concedida — trocar `{modalNovo && (` por `{modalNovo && podeAcessar("agendamento.criar").permitido && (` e `{modalBloqueio && (` por `{modalBloqueio && podeAcessar("agenda.gerenciar").permitido && (`.

- [ ] **Step 5: Mesma proteção na agenda do profissional (`profissional/agenda/page.tsx`)**

Em `src/app/profissional/agenda/page.tsx`:
1. Adicionar `podeAcessar` à desestruturação de `useTenant()` (linha 37): `const { terminologia, podeAcessar } = useTenant();`
2. Botão "Bloquear horário" (linhas 86-88) — envolver em `{podeAcessar("agenda.gerenciar").permitido && (...)}`.
3. Botão "Remover" de bloqueio (linhas 133-143) — mesmo padrão do Step 4.3: guardar o `onClick` com `if (!podeAcessar("agenda.gerenciar").permitido) return;` e envolver o `<button>` em `{podeAcessar("agenda.gerenciar").permitido && (...)}`.
4. `ModalDetalheAgendamento` (linhas 176-196) — mesmo padrão do Step 4.5:

```tsx
<ModalDetalheAgendamento
  aberto={Boolean(agendamentoSelecionado)}
  aoFechar={() => setAgendamentoSelecionado(null)}
  agendamento={agendamentoSelecionado}
  servico={servico}
  profissional={profissional}
  estabelecimento={estabelecimento}
  terminologia={terminologia}
  podeEditar={podeAcessar("agendamento.editar").permitido}
  podeCancelar={podeAcessar("agendamento.cancelar").permitido}
  onMudarStatus={(status) => {
    const permissaoNecessaria = status === "cancelado" ? "agendamento.cancelar" : "agendamento.editar";
    if (!podeAcessar(permissaoNecessaria).permitido) return;
    agendamentoRepository.atualizarStatus(agendamentoSelecionado.id, status, "profissional");
    recarregar();
    setAgendamentoSelecionado(null);
  }}
  onRemarcar={(novoInicio) => {
    if (!podeAcessar("agendamento.editar").permitido) return;
    const fim = new Date(novoInicio.getTime() + servico.duracaoMinutos * 60_000);
    agendamentoRepository.remarcar(agendamentoSelecionado.id, novoInicio.toISOString(), fim.toISOString(), "profissional");
    recarregar();
    setAgendamentoSelecionado(null);
  }}
/>
```

5. `ModalBloqueio` (linhas 199-208) — envolver em `{podeAcessar("agenda.gerenciar").permitido && (...)}`.

- [ ] **Step 6: Rodar testes, lint e revisão estática dos dois pontos de entrada de mutação por página**

Run: `npm run test && npm run lint`
Expected: PASS. Revisar manualmente (leitura do diff) que nenhuma função de mutação (`remover`, `alternarAtivo`, `onMudarStatus`, `onRemarcar`, criação de bloqueio/agendamento) ficou acessível só porque o botão está escondido — cada uma tem checagem própria de `podeAcessar(...)`.

---

### Task 5: Verificação final e revisão de escopo

**Files:** nenhum (só leitura/execução de comandos).

- [ ] **Step 1: Rodar a suíte completa de testes**

Run: `npm run test`
Expected: PASS, 55+ testes (50 originais + 5 da Task 1 + 5 da Task 3), nenhum teste antigo quebrado.

- [ ] **Step 2: Rodar o lint**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 3: Rodar o build e confirmar as 20 rotas**

Run: `npm run build`
Expected: build finaliza sem erro; a saída lista as mesmas 20 rotas que existiam antes (nenhuma rota nova, nenhuma removida).

- [ ] **Step 4: Revisar `git status`, `git diff --check`, `git diff --stat`**

Run: `git status --short && git diff --check && git diff --stat`
Expected: `git diff --check` sem saída (sem conflitos/whitespace); `git status --short` mostra só os arquivos desta tarefa (plano + código + testes); `git diff --stat` não deve conter nenhum arquivo de `prisma/`, `.env*`, `package.json`, `package-lock.json`, README, ou qualquer arquivo de identidade visual/branding.

- [ ] **Step 5: Checklist de revisão final dirigida (busca ativa por regressão)**

Confirmar manualmente, lendo o diff final:
- [ ] Nenhuma função de mutação (`remover`, `alternarAtivo`, `onMudarStatus`, `onRemarcar`, criar agendamento/bloqueio, salvar serviço/profissional) está protegida só pela permissão de "visualizar" — cada uma checa a permissão de "gerenciar"/"criar"/"editar"/"cancelar" correspondente.
- [ ] Todo fluxo de criação/remarcação (público, painel, agenda do profissional) chama `horarioAindaDisponivelParaProfissional` imediatamente antes de gravar.
- [ ] Nenhum cálculo de disponibilidade usa mais o fallback de 30 minutos para um agendamento com `dataHoraFim` válido de outro serviço.
- [ ] Tenant `suspenso`/`cancelado` não mostra CTA de agendamento na página pública, e a rota `/[slug]/agendar` bloqueia toda a criação.
- [ ] Nenhuma mudança fora do escopo (Prisma, banco, `.env`, dependências, branding, README, limites de plano, personalização avançada, relação serviço/profissional).

---

### Task 6: Commit único

**Files:** nenhum novo — só staging dos arquivos já modificados/criados pelas Tasks 1-4.

- [ ] **Step 1: Listar exatamente os arquivos a adicionar**

```bash
git status --short
```

Confirmar que a lista contém exatamente:
- `docs/plans/correcao-integridade-agendamento-permissoes.md`
- `src/lib/availability/engine.ts`
- `src/lib/availability/engine.test.ts`
- `src/lib/availability/consulta.ts`
- `src/lib/access/access-control.ts`
- `src/lib/access/access-control.test.ts`
- `src/app/[slug]/page.tsx`
- `src/app/[slug]/agendar/page.tsx`
- `src/app/[slug]/agendamento/[id]/page.tsx`
- `src/app/painel/servicos/page.tsx`
- `src/app/painel/profissionais/page.tsx`
- `src/app/painel/agenda/page.tsx`
- `src/app/profissional/agenda/page.tsx`
- `src/components/painel/modal-novo-agendamento.tsx`
- `src/components/painel/modal-agendamento.tsx`
- `src/components/painel/modal-servico.tsx`
- `src/components/painel/modal-profissional.tsx`

Se `git status --short` mostrar qualquer outro arquivo (ex.: `node_modules`, `.next`, ZIP, `.env`, algo em `prisma/`), PARAR e reportar — não commitar.

- [ ] **Step 2: Adicionar explicitamente cada arquivo (nunca `git add -A`)**

```bash
git add docs/plans/correcao-integridade-agendamento-permissoes.md \
  src/lib/availability/engine.ts src/lib/availability/engine.test.ts src/lib/availability/consulta.ts \
  src/lib/access/access-control.ts src/lib/access/access-control.test.ts \
  "src/app/[slug]/page.tsx" "src/app/[slug]/agendar/page.tsx" "src/app/[slug]/agendamento/[id]/page.tsx" \
  src/app/painel/servicos/page.tsx src/app/painel/profissionais/page.tsx src/app/painel/agenda/page.tsx \
  src/app/profissional/agenda/page.tsx \
  src/components/painel/modal-novo-agendamento.tsx src/components/painel/modal-agendamento.tsx \
  src/components/painel/modal-servico.tsx src/components/painel/modal-profissional.tsx
```

- [ ] **Step 3: Conferir o stage antes de commitar**

```bash
git status --short
```

Expected: só `A`/`M` nos arquivos listados no Step 1, nada mais.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: enforce scheduling and permission integrity"
```

- [ ] **Step 5: Confirmar o commit e o estado final**

```bash
git log -1 --format="%h %s"
git status --short
```

Expected: `git status --short` vazio; hash do commit disponível para o relatório final. **Não fazer `git push`.**

---

## Limitações remanescentes (fora do escopo desta tarefa — documentar no relatório, não implementar)

Autenticação real; tokens de cancelamento; concorrência real de banco; fuso horário; normalização de WhatsApp; consumidores sem telefone; relação duplicada serviço/profissional; limites dos planos; personalização avançada; acessibilidade dos modais; botões dentro de links; SEO; marca Agenda Cloud.
