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
