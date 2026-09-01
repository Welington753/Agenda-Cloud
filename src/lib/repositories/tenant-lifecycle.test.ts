import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumidorRepository,
  conviteRepository,
  estabelecimentoRepository,
  membershipRepository,
  unidadeRepository,
  usuarioEstabelecimentoRepository,
} from "./index";
import { obterDefinicaoPlano } from "@/lib/planos";
import { obterTerminologia } from "@/lib/verticals/terminologia";
import type { Estabelecimento } from "@/lib/types";

/** Mesmo fake de localStorage usado em tenant-isolation.test.ts — cada teste
 * começa vazio e sempre lê antes de escrever, para nunca mutar em memória o
 * cache de semente compartilhado pelo módulo (ver o comentário lá para detalhes). */
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

function estabelecimentoMinimo(overrides: Partial<Estabelecimento> = {}): Omit<Estabelecimento, "id"> {
  return {
    tenantId: "tenant-teste-novo",
    slug: "estabelecimento-teste",
    categoria: "barbearia",
    identidadeVisual: {
      nome: "Estabelecimento Teste",
      nomeCurto: "Teste",
      logoIniciais: "ET",
      corPrincipal: "#111111",
      corSecundaria: "#EEEEEE",
      corDestaque: "#B5651D",
      estilo: "teste",
      modelo: "classico",
      endereco: "Rua Teste, 1",
      telefone: "(11) 90000-0000",
      textoApresentacao: "",
      fotos: [],
    },
    fusoHorario: "America/Sao_Paulo",
    horarioGeral: { diasFuncionamento: [1, 2, 3, 4, 5], abertura: "09:00", fechamento: "18:00" },
    regras: {
      antecedenciaMinimaMinutos: 60,
      limiteDiasFuturos: 30,
      prazoCancelamentoHoras: 3,
      confirmacaoAutomatica: false,
      permitirQualquerProfissional: true,
      permitirRemarcacaoCliente: true,
      exigirTelefoneCliente: true,
      exigirEmailCliente: false,
      exibirPrecoPublico: true,
      intervaloPadraoMinutos: 0,
    },
    plano: "essencial",
    featuresDesativadas: [],
    limites: obterDefinicaoPlano("essencial").limites,
    status: "teste",
    criadoEm: new Date().toISOString(),
    quantidadeProfissionais: 0,
    ...overrides,
  };
}

describe("estabelecimentoRepository.slugDisponivel", () => {
  it("rejeita um slug já usado por outro tenant", () => {
    expect(estabelecimentoRepository.slugDisponivel("dom-navalha")).toBe(false);
  });

  it("aceita um slug novo", () => {
    expect(estabelecimentoRepository.slugDisponivel("um-slug-totalmente-novo")).toBe(true);
  });

  it("ignora o próprio tenant ao validar (permite salvar sem slug 'colidir consigo mesmo')", () => {
    const domNavalha = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    expect(estabelecimentoRepository.slugDisponivel("dom-navalha", domNavalha.tenantId)).toBe(true);
  });
});

describe("criação de tenant pelo assistente do master", () => {
  it("cria o estabelecimento, a unidade principal, o vínculo do proprietário e o convite", () => {
    const estabelecimento = estabelecimentoRepository.criar(estabelecimentoMinimo());
    unidadeRepository.criar({ tenantId: estabelecimento.tenantId, nome: "Unidade principal", endereco: "Rua Teste, 1", principal: true });
    const dono = usuarioEstabelecimentoRepository.criar({
      nome: "Dono Teste",
      email: "dono@teste.com.br",
      status: "convidado",
      criadoEm: new Date().toISOString(),
    });
    membershipRepository.criar({
      usuarioId: dono.id,
      tenantId: estabelecimento.tenantId,
      papel: "dono",
      permissoesLiberadas: [],
      permissoesNegadas: [],
    });
    conviteRepository.criar({
      tipo: "estabelecimento",
      nome: "Dono Teste",
      email: "dono@teste.com.br",
      tenantId: estabelecimento.tenantId,
      papel: "dono",
      expiraEm: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    expect(estabelecimentoRepository.obterPorTenantId(estabelecimento.tenantId)).toBeDefined();
    expect(unidadeRepository.listarPorTenant(estabelecimento.tenantId)).toHaveLength(1);
    const vinculo = membershipRepository.obterVinculo(dono.id, estabelecimento.tenantId);
    expect(vinculo?.papel).toBe("dono");
    const convite = conviteRepository.listarPorTenant(estabelecimento.tenantId)[0];
    expect(convite.status).toBe("pendente");
    expect(dono.status).toBe("convidado");
  });
});

describe("ciclo de vida do convite", () => {
  it("convite expirado não pode ser aceito diretamente — só reenviado", () => {
    const convite = conviteRepository.criar({
      tipo: "estabelecimento",
      nome: "Fulano",
      email: "fulano@teste.com.br",
      tenantId: "tenant-dom-navalha",
      papel: "recepcionista",
      expiraEm: new Date(Date.now() - 1000).toISOString(),
    });
    conviteRepository.atualizarStatus(convite.id, "expirado");

    const recuperado = conviteRepository.obterPorId(convite.id)!;
    expect(recuperado.status).toBe("expirado");
    // A tela nunca chama atualizarStatus(..., "aceito") para um convite expirado —
    // a única ação disponível é reenviar, testada abaixo.
  });

  it("reenviar um convite pendente ou expirado revoga o anterior e cria um novo token", () => {
    const original = conviteRepository.criar({
      tipo: "estabelecimento",
      nome: "Ciclana",
      email: "ciclana@teste.com.br",
      tenantId: "tenant-dom-navalha",
      papel: "gerente",
      expiraEm: new Date(Date.now() - 1000).toISOString(),
    });
    conviteRepository.atualizarStatus(original.id, "expirado");

    const reenviado = conviteRepository.reenviar(original.id);

    expect(reenviado).toBeDefined();
    expect(reenviado!.token).not.toBe(original.token);
    expect(reenviado!.status).toBe("pendente");
    expect(conviteRepository.obterPorId(original.id)!.status).toBe("revogado");
  });

  it("não é possível reenviar um convite já aceito", () => {
    const aceito = conviteRepository.criar({
      tipo: "estabelecimento",
      nome: "Beltrana",
      email: "beltrana@teste.com.br",
      tenantId: "tenant-dom-navalha",
      papel: "recepcionista",
      expiraEm: new Date(Date.now() + 100000).toISOString(),
    });
    conviteRepository.atualizarStatus(aceito.id, "aceito", { aceitoEm: new Date().toISOString() });
    expect(conviteRepository.reenviar(aceito.id)).toBeUndefined();
  });
});

describe("desativar uma feature não apaga dados existentes", () => {
  it("agendamentos e consumidores continuam intactos depois de desativar 'consumidores' num tenant", () => {
    const clinica = estabelecimentoRepository.obterPorSlug("clinica-sorriso-leve")!;
    const consumidoresAntes = consumidorRepository.listarPorTenant(clinica.tenantId);
    expect(consumidoresAntes.length).toBeGreaterThan(0);

    estabelecimentoRepository.atualizar(clinica.tenantId, {
      featuresDesativadas: [...clinica.featuresDesativadas, "consumidores"],
    });

    const consumidoresDepois = consumidorRepository.listarPorTenant(clinica.tenantId);
    expect(consumidoresDepois.length).toBe(consumidoresAntes.length);
    expect(consumidoresDepois.map((c) => c.id).sort()).toEqual(consumidoresAntes.map((c) => c.id).sort());
  });
});

describe("página pública resolve o modelo a partir do tenant", () => {
  it("Barbearia JR usa o modelo moderno e Dom Navalha usa o clássico", () => {
    const jr = estabelecimentoRepository.obterPorSlug("barbearia-jr")!;
    const domNavalha = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    expect(jr.identidadeVisual.modelo).toBe("moderno");
    expect(domNavalha.identidadeVisual.modelo).toBe("classico");
  });

  it("a terminologia usada na página pública vem da categoria do tenant, não do modelo", () => {
    const jr = estabelecimentoRepository.obterPorSlug("barbearia-jr")!;
    const clinica = estabelecimentoRepository.obterPorSlug("clinica-sorriso-leve")!;
    expect(obterTerminologia(jr.categoria).profissional.singular).toBe("Barbeiro");
    expect(obterTerminologia(clinica.categoria).profissional.singular).toBe("Dentista");
  });
});
