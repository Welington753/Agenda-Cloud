// Repositórios sobre localStorage. Cada função aqui é a "interface" que a UI consome;
// para trocar por uma API real no futuro, basta reescrever este arquivo mantendo as
// mesmas assinaturas — os componentes não mudam.

import { readCollection, writeCollection, STORAGE_KEYS } from "@/lib/storage/local-storage";
import { obterSeedCompleto } from "@/lib/seed-data";
import { calcularComissao, validarRegraComissao } from "@/lib/comissoes/engine";
import { featureHabilitada } from "@/lib/access/access-control";
import { validarIdentidadeVisual, validarSlugEstabelecimento } from "@/lib/estabelecimentos/validacao";
import type {
  Agendamento,
  Bloqueio,
  Consumidor,
  Convite,
  Estabelecimento,
  LancamentoComissao,
  Membership,
  Profissional,
  RegistroAuditoria,
  RegraComissao,
  Recurso,
  Servico,
  StatusAgendamento,
  StatusConvite,
  Unidade,
  UsuarioEstabelecimento,
  UsuarioPlataforma,
} from "@/lib/types";

function gerarId(prefixo: string): string {
  return `${prefixo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- Estabelecimentos ----------
export const estabelecimentoRepository = {
  listarTodos(): Estabelecimento[] {
    return readCollection(STORAGE_KEYS.estabelecimentos, obterSeedCompleto().estabelecimentos);
  },
  obterPorSlug(slug: string): Estabelecimento | undefined {
    return this.listarTodos().find((e) => e.slug === slug);
  },
  obterPorTenantId(tenantId: string): Estabelecimento | undefined {
    return this.listarTodos().find((e) => e.tenantId === tenantId);
  },
  slugDisponivel(slug: string, ignorarTenantId?: string): boolean {
    return !this.listarTodos().some((e) => e.slug === slug && e.tenantId !== ignorarTenantId);
  },
  // A validação aqui é a barreira real — nunca confia que quem chamou (formulário
  // de criação no Master, tela de configurações/personalização) já validou. Mesma
  // disciplina aplicada a `comissaoRegraRepository.salvar` nesta sessão.
  criar(dados: Omit<Estabelecimento, "id">): Estabelecimento {
    const validacaoSlug = validarSlugEstabelecimento(dados.slug, this.listarTodos());
    if (!validacaoSlug.valido) throw new Error(validacaoSlug.motivo);
    const validacaoIdentidade = validarIdentidadeVisual(dados.identidadeVisual);
    if (!validacaoIdentidade.valido) throw new Error(validacaoIdentidade.motivo);

    const novo: Estabelecimento = { ...dados, id: gerarId("estab") };
    writeCollection(STORAGE_KEYS.estabelecimentos, [...this.listarTodos(), novo]);
    return novo;
  },
  atualizar(tenantId: string, dados: Partial<Estabelecimento>): Estabelecimento | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((e) => e.tenantId === tenantId);
    if (idx === -1) return undefined;

    if (dados.slug !== undefined) {
      const validacaoSlug = validarSlugEstabelecimento(dados.slug, todos, tenantId);
      if (!validacaoSlug.valido) throw new Error(validacaoSlug.motivo);
    }
    if (dados.identidadeVisual) {
      const validacaoIdentidade = validarIdentidadeVisual(dados.identidadeVisual);
      if (!validacaoIdentidade.valido) throw new Error(validacaoIdentidade.motivo);
      // Personalização avançada (ordem das seções, rodapé, ocultar marca) só existe
      // no plano atual do tenant — esconder o formulário não basta, ver Lote 1.
      if (dados.identidadeVisual.personalizacaoAvancada) {
        const atual = todos[idx];
        if (!featureHabilitada(atual.plano, atual.featuresDesativadas, "personalizacaoAvancada")) {
          throw new Error("Personalização avançada não está disponível no plano atual.");
        }
      }
    }

    todos[idx] = { ...todos[idx], ...dados };
    writeCollection(STORAGE_KEYS.estabelecimentos, todos);
    return todos[idx];
  },
};

// ---------- Profissionais ----------
export const profissionalRepository = {
  listarTodos(): Profissional[] {
    return readCollection(STORAGE_KEYS.profissionais, obterSeedCompleto().profissionais);
  },
  listarPorTenant(tenantId: string): Profissional[] {
    return this.listarTodos().filter((p) => p.tenantId === tenantId);
  },
  obterPorId(id: string): Profissional | undefined {
    return this.listarTodos().find((p) => p.id === id);
  },
  criar(dados: Omit<Profissional, "id">): Profissional {
    const novo: Profissional = { ...dados, id: gerarId("prof") };
    const todos = [...this.listarTodos(), novo];
    writeCollection(STORAGE_KEYS.profissionais, todos);
    return novo;
  },
  atualizar(id: string, dados: Partial<Profissional>): Profissional | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((p) => p.id === id);
    if (idx === -1) return undefined;
    todos[idx] = { ...todos[idx], ...dados };
    writeCollection(STORAGE_KEYS.profissionais, todos);
    return todos[idx];
  },
  remover(id: string): void {
    writeCollection(STORAGE_KEYS.profissionais, this.listarTodos().filter((p) => p.id !== id));
  },
};

// ---------- Serviços ----------
export const servicoRepository = {
  listarTodos(): Servico[] {
    return readCollection(STORAGE_KEYS.servicos, obterSeedCompleto().servicos);
  },
  listarPorTenant(tenantId: string): Servico[] {
    return this.listarTodos().filter((s) => s.tenantId === tenantId);
  },
  obterPorId(id: string): Servico | undefined {
    return this.listarTodos().find((s) => s.id === id);
  },
  criar(dados: Omit<Servico, "id">): Servico {
    const novo: Servico = { ...dados, id: gerarId("serv") };
    writeCollection(STORAGE_KEYS.servicos, [...this.listarTodos(), novo]);
    return novo;
  },
  atualizar(id: string, dados: Partial<Servico>): Servico | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((s) => s.id === id);
    if (idx === -1) return undefined;
    todos[idx] = { ...todos[idx], ...dados };
    writeCollection(STORAGE_KEYS.servicos, todos);
    return todos[idx];
  },
  remover(id: string): void {
    writeCollection(STORAGE_KEYS.servicos, this.listarTodos().filter((s) => s.id !== id));
  },
};

// ---------- Consumidores ----------
export const consumidorRepository = {
  listarTodos(): Consumidor[] {
    return readCollection(STORAGE_KEYS.consumidores, obterSeedCompleto().consumidores);
  },
  listarPorTenant(tenantId: string): Consumidor[] {
    return this.listarTodos().filter((c) => c.tenantId === tenantId);
  },
  obterPorId(id: string): Consumidor | undefined {
    return this.listarTodos().find((c) => c.id === id);
  },
  /** O mesmo telefone pode existir em vários tenants — cada um gera um registro
   * `Consumidor` isolado; um tenant nunca enxerga o histórico desse número em
   * outro. A busca abaixo já filtra por `tenantId` para garantir isso. */
  obterOuCriarPorWhatsapp(tenantId: string, nome: string, whatsapp: string): Consumidor {
    const todos = this.listarTodos();
    const existente = todos.find((c) => c.tenantId === tenantId && c.whatsapp === whatsapp);
    if (existente) return existente;
    const novo: Consumidor = { id: gerarId("cons"), tenantId, nome, whatsapp, totalVisitas: 0, totalFaltas: 0 };
    writeCollection(STORAGE_KEYS.consumidores, [...todos, novo]);
    return novo;
  },
  atualizar(id: string, dados: Partial<Consumidor>): Consumidor | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((c) => c.id === id);
    if (idx === -1) return undefined;
    todos[idx] = { ...todos[idx], ...dados };
    writeCollection(STORAGE_KEYS.consumidores, todos);
    return todos[idx];
  },
};

// ---------- Bloqueios ----------
export const bloqueioRepository = {
  listarTodos(): Bloqueio[] {
    return readCollection(STORAGE_KEYS.bloqueios, obterSeedCompleto().bloqueios);
  },
  listarPorTenant(tenantId: string): Bloqueio[] {
    return this.listarTodos().filter((b) => b.tenantId === tenantId);
  },
  listarPorProfissional(profissionalId: string): Bloqueio[] {
    return this.listarTodos().filter((b) => b.profissionalId === profissionalId);
  },
  criar(dados: Omit<Bloqueio, "id">): Bloqueio {
    const novo: Bloqueio = { ...dados, id: gerarId("bloq") };
    writeCollection(STORAGE_KEYS.bloqueios, [...this.listarTodos(), novo]);
    return novo;
  },
  remover(id: string): void {
    writeCollection(STORAGE_KEYS.bloqueios, this.listarTodos().filter((b) => b.id !== id));
  },
};

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
   * de unicidade nem de um campo `ativa`. É a barreira de integridade real: valida
   * tenant/profissional/serviço/tipo/valor por conta própria, nunca confia que
   * quem chamou (a tela, ou qualquer código futuro) já validou. Lança `Error` com
   * mensagem segura para mostrar ao usuário quando os dados são inválidos — nada é
   * gravado e nenhuma regra anterior é alterada. */
  salvar(dados: Omit<RegraComissao, "id" | "criadoEm" | "atualizadoEm">): RegraComissao {
    const estabelecimento = estabelecimentoRepository.obterPorTenantId(dados.tenantId);
    if (!estabelecimento) {
      throw new Error("Não foi possível salvar: estabelecimento não encontrado.");
    }
    const profissional = profissionalRepository.obterPorId(dados.profissionalId);
    if (!profissional || profissional.tenantId !== dados.tenantId) {
      throw new Error("Não foi possível salvar: profissional não encontrado neste estabelecimento.");
    }
    const servico = servicoRepository.obterPorId(dados.servicoId);
    if (!servico || servico.tenantId !== dados.tenantId) {
      throw new Error("Não foi possível salvar: serviço não encontrado neste estabelecimento.");
    }
    if (dados.tipo !== "percentual" && dados.tipo !== "fixo") {
      throw new Error("Não foi possível salvar: tipo de comissão inválido.");
    }
    if (!Number.isFinite(dados.valor)) {
      throw new Error("Não foi possível salvar: valor da comissão inválido.");
    }
    const validacao = validarRegraComissao({ tipo: dados.tipo, valor: dados.valor, profissional, servico });
    if (!validacao.valido) {
      throw new Error(validacao.erro ?? "Não foi possível salvar: regra de comissão inválida.");
    }

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
  /** Reativa um lançamento estornado (agendamento revertido e concluído de novo)
   * — só troca `status` para `confirmado` e preenche `reativadoEm`. Nunca toca em
   * nenhum dos valores congelados (preço, tipo, regra aplicada, valores de
   * profissional/estabelecimento): a reconclusão nunca relê a regra atual nem
   * recalcula nada. */
  reativar(id: string): LancamentoComissao | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((l) => l.id === id);
    if (idx === -1) return undefined;
    todos[idx] = { ...todos[idx], status: "confirmado", reativadoEm: new Date().toISOString() };
    writeCollection(STORAGE_KEYS.lancamentosComissao, todos);
    return todos[idx];
  },
};

/** Gera (ou reativa) o lançamento de comissão quando um agendamento é concluído.
 * Se já existir um lançamento para este agendamento — reconclusão depois de um
 * estorno —, reativa o MESMO registro em vez de criar outro, preservando o
 * snapshot financeiro original (nunca relê a regra atual). Se já existir e
 * estiver confirmado, é no-op idempotente (conclusão repetida). Só calcula um
 * lançamento novo quando não existe nenhum ainda. Sem preço definido no
 * agendamento ("sob consulta"), não há valor para dividir — não gera lançamento.
 * Sem regra configurada para o par profissional+serviço, gera um lançamento com
 * comissão 0 (100% para o estabelecimento) — ausência de configuração nunca
 * impede a conclusão do atendimento. */
function consolidarComissaoDoAgendamento(agendamento: Agendamento): void {
  const existente = lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id);
  if (existente) {
    if (existente.status === "estornado") {
      lancamentoComissaoRepository.reativar(existente.id);
    }
    return;
  }
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

// ---------- Unidades ----------
export const unidadeRepository = {
  listarTodos(): Unidade[] {
    return readCollection(STORAGE_KEYS.unidades, obterSeedCompleto().unidades);
  },
  listarPorTenant(tenantId: string): Unidade[] {
    return this.listarTodos().filter((u) => u.tenantId === tenantId);
  },
  criar(dados: Omit<Unidade, "id">): Unidade {
    const nova: Unidade = { ...dados, id: gerarId("unid") };
    writeCollection(STORAGE_KEYS.unidades, [...this.listarTodos(), nova]);
    return nova;
  },
};

// ---------- Recursos ----------
// Somente leitura nesta fase: modelado para evolução futura (bloqueio simultâneo
// de recursos ainda não é verificado pelo motor de disponibilidade).
export const recursoRepository = {
  listarTodos(): Recurso[] {
    return readCollection(STORAGE_KEYS.recursos, obterSeedCompleto().recursos);
  },
  listarPorTenant(tenantId: string): Recurso[] {
    return this.listarTodos().filter((r) => r.tenantId === tenantId);
  },
};

// ---------- Agendamentos ----------
export const agendamentoRepository = {
  listarTodos(): Agendamento[] {
    return readCollection(STORAGE_KEYS.agendamentos, obterSeedCompleto().agendamentos);
  },
  listarPorTenant(tenantId: string): Agendamento[] {
    return this.listarTodos().filter((a) => a.tenantId === tenantId);
  },
  listarPorProfissional(profissionalId: string): Agendamento[] {
    return this.listarTodos().filter((a) => a.profissionalId === profissionalId);
  },
  obterPorId(id: string): Agendamento | undefined {
    return this.listarTodos().find((a) => a.id === id);
  },
  criar(dados: Omit<Agendamento, "id" | "criadoEm" | "historico">): Agendamento {
    const agora = new Date().toISOString();
    const novo: Agendamento = {
      ...dados,
      id: gerarId("ag"),
      criadoEm: agora,
      historico: [{ em: agora, de: "criado", para: dados.status, por: "consumidor" }],
    };
    writeCollection(STORAGE_KEYS.agendamentos, [...this.listarTodos(), novo]);
    return novo;
  },
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
  /** Rejeita remarcar um agendamento já concluído — a barreira fica aqui, não só
   * na interface. Para corrigir um atendimento concluído é preciso primeiro mudar
   * o status (o que estorna a comissão via `atualizarStatus`), só depois ele pode
   * ser remarcado. Como um agendamento concluído nunca chega a ser reescrito por
   * este método, remarcar nunca cria nem estorna comissão. */
  remarcar(id: string, novoInicio: string, novoFim: string, por: string): Agendamento | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((a) => a.id === id);
    if (idx === -1) return undefined;
    const anterior = todos[idx];
    if (anterior.status === "concluido") {
      throw new Error("Não é possível remarcar um agendamento já concluído. Altere o status primeiro.");
    }
    todos[idx] = {
      ...anterior,
      dataHoraInicio: novoInicio,
      dataHoraFim: novoFim,
      status: "pendente",
      historico: [...anterior.historico, { em: new Date().toISOString(), de: anterior.status, para: "pendente", por }],
    };
    writeCollection(STORAGE_KEYS.agendamentos, todos);
    return todos[idx];
  },
};

// ---------- Usuários de plataforma (administradores master) ----------
export const usuarioPlataformaRepository = {
  listarTodos(): UsuarioPlataforma[] {
    return readCollection(STORAGE_KEYS.usuariosPlataforma, obterSeedCompleto().usuariosPlataforma);
  },
  obterPorId(id: string): UsuarioPlataforma | undefined {
    return this.listarTodos().find((u) => u.id === id);
  },
  obterPorEmail(email: string): UsuarioPlataforma | undefined {
    return this.listarTodos().find((u) => u.email.toLowerCase() === email.toLowerCase());
  },
  criar(dados: Omit<UsuarioPlataforma, "id">): UsuarioPlataforma {
    const novo: UsuarioPlataforma = { ...dados, id: gerarId("mstr") };
    writeCollection(STORAGE_KEYS.usuariosPlataforma, [...this.listarTodos(), novo]);
    return novo;
  },
  atualizar(id: string, dados: Partial<UsuarioPlataforma>): UsuarioPlataforma | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((u) => u.id === id);
    if (idx === -1) return undefined;
    todos[idx] = { ...todos[idx], ...dados };
    writeCollection(STORAGE_KEYS.usuariosPlataforma, todos);
    return todos[idx];
  },
  remover(id: string): void {
    writeCollection(STORAGE_KEYS.usuariosPlataforma, this.listarTodos().filter((u) => u.id !== id));
  },
};

// ---------- Usuários de estabelecimento (equipe) ----------
export const usuarioEstabelecimentoRepository = {
  listarTodos(): UsuarioEstabelecimento[] {
    return readCollection(STORAGE_KEYS.usuariosEstabelecimento, obterSeedCompleto().usuariosEstabelecimento);
  },
  obterPorId(id: string): UsuarioEstabelecimento | undefined {
    return this.listarTodos().find((u) => u.id === id);
  },
  obterPorEmail(email: string): UsuarioEstabelecimento | undefined {
    return this.listarTodos().find((u) => u.email.toLowerCase() === email.toLowerCase());
  },
  criar(dados: Omit<UsuarioEstabelecimento, "id">): UsuarioEstabelecimento {
    const novo: UsuarioEstabelecimento = { ...dados, id: gerarId("user") };
    writeCollection(STORAGE_KEYS.usuariosEstabelecimento, [...this.listarTodos(), novo]);
    return novo;
  },
  atualizar(id: string, dados: Partial<UsuarioEstabelecimento>): UsuarioEstabelecimento | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((u) => u.id === id);
    if (idx === -1) return undefined;
    todos[idx] = { ...todos[idx], ...dados };
    writeCollection(STORAGE_KEYS.usuariosEstabelecimento, todos);
    return todos[idx];
  },
};

// ---------- Memberships (vínculo usuário de estabelecimento + tenant) ----------
export const membershipRepository = {
  listarTodos(): Membership[] {
    return readCollection(STORAGE_KEYS.memberships, obterSeedCompleto().memberships);
  },
  listarPorTenant(tenantId: string): Membership[] {
    return this.listarTodos().filter((m) => m.tenantId === tenantId);
  },
  listarPorUsuario(usuarioId: string): Membership[] {
    return this.listarTodos().filter((m) => m.usuarioId === usuarioId);
  },
  /** Um usuário pode, arquiteturalmente, ter vínculos com mais de um tenant —
   * nesta fase de demonstração cada usuário só tem um, mas a consulta já busca
   * o vínculo certo em vez de assumir isso. */
  obterVinculo(usuarioId: string, tenantId: string): Membership | undefined {
    return this.listarTodos().find((m) => m.usuarioId === usuarioId && m.tenantId === tenantId);
  },
  obterPorId(id: string): Membership | undefined {
    return this.listarTodos().find((m) => m.id === id);
  },
  criar(dados: Omit<Membership, "id" | "criadoEm">): Membership {
    const novo: Membership = { ...dados, id: gerarId("memb"), criadoEm: new Date().toISOString() };
    writeCollection(STORAGE_KEYS.memberships, [...this.listarTodos(), novo]);
    return novo;
  },
  atualizar(id: string, dados: Partial<Membership>): Membership | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((m) => m.id === id);
    if (idx === -1) return undefined;
    todos[idx] = { ...todos[idx], ...dados };
    writeCollection(STORAGE_KEYS.memberships, todos);
    return todos[idx];
  },
};

// ---------- Convites ----------
export const conviteRepository = {
  listarTodos(): Convite[] {
    return readCollection(STORAGE_KEYS.convites, obterSeedCompleto().convites);
  },
  listarPorTenant(tenantId: string): Convite[] {
    return this.listarTodos().filter((c) => c.tenantId === tenantId);
  },
  listarPlataforma(): Convite[] {
    return this.listarTodos().filter((c) => c.tipo === "plataforma");
  },
  obterPorToken(token: string): Convite | undefined {
    return this.listarTodos().find((c) => c.token === token);
  },
  obterPorId(id: string): Convite | undefined {
    return this.listarTodos().find((c) => c.id === id);
  },
  criar(dados: Omit<Convite, "id" | "token" | "criadoEm" | "status">): Convite {
    const novo: Convite = {
      ...dados,
      id: gerarId("conv"),
      token: gerarId("tok"),
      status: "pendente",
      criadoEm: new Date().toISOString(),
    };
    writeCollection(STORAGE_KEYS.convites, [...this.listarTodos(), novo]);
    return novo;
  },
  atualizarStatus(id: string, status: StatusConvite, extra?: Partial<Convite>): Convite | undefined {
    const todos = this.listarTodos();
    const idx = todos.findIndex((c) => c.id === id);
    if (idx === -1) return undefined;
    todos[idx] = { ...todos[idx], status, ...extra };
    writeCollection(STORAGE_KEYS.convites, todos);
    return todos[idx];
  },
  /** Reenviar invalida o convite anterior (marca como revogado) e cria um novo
   * com token e prazo de expiração novos — nunca reaproveita o token antigo. */
  reenviar(id: string, diasParaExpirar = 7): Convite | undefined {
    const anterior = this.obterPorId(id);
    const podeReenviar = anterior && (anterior.status === "pendente" || anterior.status === "expirado");
    if (!anterior || !podeReenviar) return undefined;
    this.atualizarStatus(id, "revogado");
    return this.criar({
      tipo: anterior.tipo,
      nome: anterior.nome,
      email: anterior.email,
      tenantId: anterior.tenantId,
      papel: anterior.papel,
      expiraEm: new Date(Date.now() + diasParaExpirar * 24 * 60 * 60 * 1000).toISOString(),
    });
  },
};

// ---------- Auditoria ----------
export const auditoriaRepository = {
  listarTodos(): RegistroAuditoria[] {
    return readCollection(STORAGE_KEYS.auditoria, obterSeedCompleto().auditoria);
  },
  listarPorTenant(tenantId: string): RegistroAuditoria[] {
    return this.listarTodos()
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => new Date(b.em).getTime() - new Date(a.em).getTime());
  },
  listarRecentes(limite = 50): RegistroAuditoria[] {
    return [...this.listarTodos()].sort((a, b) => new Date(b.em).getTime() - new Date(a.em).getTime()).slice(0, limite);
  },
  registrar(dados: Omit<RegistroAuditoria, "id" | "em">): RegistroAuditoria {
    const novo: RegistroAuditoria = { ...dados, id: gerarId("audit"), em: new Date().toISOString() };
    writeCollection(STORAGE_KEYS.auditoria, [...this.listarTodos(), novo]);
    return novo;
  },
};
