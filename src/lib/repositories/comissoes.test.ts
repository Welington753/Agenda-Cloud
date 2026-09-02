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

describe("comissaoRegraRepository.salvar como barreira de integridade", () => {
  function baseRegra(overrides: Partial<Parameters<typeof comissaoRegraRepository.salvar>[0]> = {}) {
    const tenant = tenantDomNavalha();
    return {
      tenantId: tenant.tenantId,
      profissionalId: "prof-joao-silva",
      servicoId: "serv-corte-tradicional",
      tipo: "percentual" as const,
      valor: 40,
      ...overrides,
    };
  }

  it("rejeita percentual negativo, sem gravar nada e sem alterar a regra semeada (40%)", () => {
    const tenant = tenantDomNavalha();
    expect(() => comissaoRegraRepository.salvar(baseRegra({ valor: -1 }))).toThrow();
    const regraSemeada = comissaoRegraRepository.obterPorProfissionalEServico(
      tenant.tenantId,
      "prof-joao-silva",
      "serv-corte-tradicional"
    );
    expect(regraSemeada?.valor).toBe(40);
  });

  it("rejeita percentual acima de 100", () => {
    expect(() => comissaoRegraRepository.salvar(baseRegra({ valor: 101 }))).toThrow();
  });

  it("rejeita valor NaN", () => {
    expect(() => comissaoRegraRepository.salvar(baseRegra({ valor: Number.NaN }))).toThrow();
  });

  it("rejeita valor infinito", () => {
    expect(() => comissaoRegraRepository.salvar(baseRegra({ valor: Number.POSITIVE_INFINITY }))).toThrow();
  });

  it("rejeita valor fixo negativo", () => {
    expect(() => comissaoRegraRepository.salvar(baseRegra({ tipo: "fixo", valor: -100 }))).toThrow();
  });

  it("rejeita valor fixo maior que o preço atual do serviço", () => {
    // serv-corte-tradicional custa R$40 (4000 centavos) no seed.
    expect(() => comissaoRegraRepository.salvar(baseRegra({ tipo: "fixo", valor: 5000 }))).toThrow();
  });

  it("rejeita profissional de outro tenant", () => {
    expect(() => comissaoRegraRepository.salvar(baseRegra({ profissionalId: "prof-lucas-ferreira" }))).toThrow();
  });

  it("rejeita serviço de outro tenant", () => {
    expect(() => comissaoRegraRepository.salvar(baseRegra({ servicoId: "serv-avaliacao-inicial" }))).toThrow();
  });

  it("rejeita serviço não vinculado ao profissional", () => {
    // serv-corte-infantil é do mesmo tenant, mas só está em servicosIds de João —
    // Pedro Martins não realiza esse serviço, então a combinação é inválida mesmo
    // sendo tudo do mesmo tenant.
    expect(() =>
      comissaoRegraRepository.salvar(baseRegra({ profissionalId: "prof-pedro-martins", servicoId: "serv-corte-infantil" }))
    ).toThrow();
  });

  it("aceita regra válida e persiste", () => {
    const salva = comissaoRegraRepository.salvar(baseRegra({ valor: 55 }));
    expect(salva.valor).toBe(55);
    const relida = comissaoRegraRepository.obterPorProfissionalEServico(
      salva.tenantId,
      "prof-joao-silva",
      "serv-corte-tradicional"
    );
    expect(relida?.valor).toBe(55);
  });

  it("uma tentativa inválida não sobrescreve uma regra válida anterior", () => {
    const valida = comissaoRegraRepository.salvar(baseRegra({ valor: 40 }));
    expect(() => comissaoRegraRepository.salvar(baseRegra({ valor: 999 }))).toThrow();
    const aindaValida = comissaoRegraRepository.obterPorProfissionalEServico(
      valida.tenantId,
      "prof-joao-silva",
      "serv-corte-tradicional"
    );
    expect(aindaValida?.valor).toBe(40);
  });
});

describe("remarcação de agendamento concluído", () => {
  it("agendamento futuro (não concluído) é remarcado normalmente e não gera nem estorna comissão", () => {
    const agendamento = criarAgendamentoDeTeste();
    const novoInicio = new Date("2026-02-12T10:00:00.000Z").toISOString();
    const novoFim = new Date("2026-02-12T10:30:00.000Z").toISOString();
    const remarcado = agendamentoRepository.remarcar(agendamento.id, novoInicio, novoFim, "dono");
    expect(remarcado?.dataHoraInicio).toBe(novoInicio);
    expect(remarcado?.status).toBe("pendente");
    expect(lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)).toBeUndefined();
  });

  it("agendamento concluído não pode ser remarcado diretamente", () => {
    const agendamento = criarAgendamentoDeTeste();
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    const novoInicio = new Date("2026-02-12T10:00:00.000Z").toISOString();
    const novoFim = new Date("2026-02-12T10:30:00.000Z").toISOString();
    expect(() => agendamentoRepository.remarcar(agendamento.id, novoInicio, novoFim, "dono")).toThrow();
    // O agendamento continua concluído, sem alteração de horário.
    const inalterado = agendamentoRepository.obterPorId(agendamento.id)!;
    expect(inalterado.status).toBe("concluido");
    expect(inalterado.dataHoraInicio).not.toBe(novoInicio);
  });

  it("concluído → cancelado → remarcado funciona (estorna a comissão, depois remarca normalmente)", () => {
    const agendamento = criarAgendamentoDeTeste();
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    agendamentoRepository.atualizarStatus(agendamento.id, "cancelado", "dono");
    expect(lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)?.status).toBe("estornado");

    const novoInicio = new Date("2026-02-12T10:00:00.000Z").toISOString();
    const novoFim = new Date("2026-02-12T10:30:00.000Z").toISOString();
    const remarcado = agendamentoRepository.remarcar(agendamento.id, novoInicio, novoFim, "dono");
    expect(remarcado?.status).toBe("pendente");
  });
});

describe("reconclusão após estorno reativa o mesmo lançamento", () => {
  it("concluído → cancelado → concluído de novo reativa o lançamento original, preservando os valores antigos mesmo com a regra alterada", () => {
    const agendamento = criarAgendamentoDeTeste(10000); // R$100
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    const original = lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)!;
    expect(original.valorProfissionalCentavos).toBe(4000); // 40% de R$100
    expect(original.valorEstabelecimentoCentavos).toBe(6000);
    const idOriginal = original.id;

    agendamentoRepository.atualizarStatus(agendamento.id, "cancelado", "dono");
    expect(lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)?.status).toBe("estornado");

    // Regra muda para 50% — não pode afetar o lançamento reativado.
    comissaoRegraRepository.salvar({
      tenantId: original.tenantId,
      profissionalId: "prof-joao-silva",
      servicoId: "serv-corte-tradicional",
      tipo: "percentual",
      valor: 50,
    });

    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    const reativado = lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)!;
    expect(reativado.id).toBe(idOriginal); // mesmo registro, nenhuma linha nova
    expect(reativado.status).toBe("confirmado");
    expect(reativado.valorProfissionalCentavos).toBe(4000); // preservado, não recalculado
    expect(reativado.valorEstabelecimentoCentavos).toBe(6000);
    expect(reativado.valorRegraAplicada).toBe(40); // snapshot antigo, não a regra nova de 50%

    const todos = lancamentoComissaoRepository.listarTodos().filter((l) => l.agendamentoId === agendamento.id);
    expect(todos).toHaveLength(1);
  });

  it("concluir quando já está confirmado continua idempotente (no-op)", () => {
    const agendamento = criarAgendamentoDeTeste();
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    const primeiro = lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)!;
    agendamentoRepository.atualizarStatus(agendamento.id, "concluido", "dono");
    const segundo = lancamentoComissaoRepository.obterPorAgendamentoId(agendamento.id)!;
    expect(segundo.id).toBe(primeiro.id);
    expect(segundo.calculadoEm).toBe(primeiro.calculadoEm);
    const todos = lancamentoComissaoRepository.listarTodos().filter((l) => l.agendamentoId === agendamento.id);
    expect(todos).toHaveLength(1);
  });
});
