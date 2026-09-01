import { addDays, getDay } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agendamentoRepository,
  consumidorRepository,
  estabelecimentoRepository,
  profissionalRepository,
  servicoRepository,
} from "./index";
import { restaurarTenant } from "./restaurar";
import { horariosLivresDoProfissionalNoDia } from "@/lib/availability/consulta";
import type { DiaSemana } from "@/lib/types";

/** Fake mínimo de localStorage — só o que os repositórios usam (getItem/setItem/
 * removeItem). Cada teste começa com um fake novo e vazio, então cada `it()`
 * sempre faz uma leitura simples antes de qualquer escrita, replicando o fluxo
 * real do app (a tela sempre lista antes de editar) e evitando mutar em memória o
 * cache de semente compartilhado pelo módulo. */
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

describe("resolução de estabelecimento por slug", () => {
  it("resolve dom-navalha e clinica-sorriso-leve pelos respectivos slugs", () => {
    const domNavalha = estabelecimentoRepository.obterPorSlug("dom-navalha");
    const clinica = estabelecimentoRepository.obterPorSlug("clinica-sorriso-leve");
    expect(domNavalha?.categoria).toBe("barbearia");
    expect(clinica?.categoria).toBe("clinica_odontologica");
    expect(domNavalha?.tenantId).not.toBe(clinica?.tenantId);
  });

  it("retorna undefined para um slug inexistente, sem cair para outro tenant", () => {
    expect(estabelecimentoRepository.obterPorSlug("nao-existe-nesta-demonstracao")).toBeUndefined();
  });
});

describe("isolamento entre tenants", () => {
  it("agendamentos de um tenant nunca aparecem para outro", () => {
    const domNavalha = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    const clinica = estabelecimentoRepository.obterPorSlug("clinica-sorriso-leve")!;

    const agendamentosNavalha = agendamentoRepository.listarPorTenant(domNavalha.tenantId);
    const agendamentosClinica = agendamentoRepository.listarPorTenant(clinica.tenantId);

    expect(agendamentosNavalha.length).toBeGreaterThan(0);
    expect(agendamentosClinica.length).toBeGreaterThan(0);
    expect(agendamentosNavalha.every((a) => a.tenantId === domNavalha.tenantId)).toBe(true);
    expect(agendamentosClinica.every((a) => a.tenantId === clinica.tenantId)).toBe(true);
  });

  it("consumidores de um tenant nunca aparecem para outro", () => {
    const domNavalha = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    const clinica = estabelecimentoRepository.obterPorSlug("clinica-sorriso-leve")!;

    const consumidoresNavalha = consumidorRepository.listarPorTenant(domNavalha.tenantId);
    const consumidoresClinica = consumidorRepository.listarPorTenant(clinica.tenantId);

    expect(consumidoresNavalha.length).toBeGreaterThan(0);
    expect(consumidoresClinica.length).toBeGreaterThan(0);
    expect(consumidoresNavalha.every((c) => c.tenantId === domNavalha.tenantId)).toBe(true);
    expect(consumidoresClinica.every((c) => c.tenantId === clinica.tenantId)).toBe(true);
  });

  it("o mesmo telefone em dois tenants gera dois registros de consumidor isolados", () => {
    // Rodrigo Lima usa o mesmo whatsapp na Dom Navalha e na Barbearia JR
    // (ver seed-data.ts) — cada tenant deve enxergar só o próprio registro.
    const domNavalha = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    const barbeariaJr = estabelecimentoRepository.obterPorSlug("barbearia-jr")!;
    const barbeiroBastiao = estabelecimentoRepository.obterPorSlug("barbeiro-bastiao")!;

    const consumidoresNavalha = consumidorRepository.listarPorTenant(domNavalha.tenantId);
    const consumidoresJr = consumidorRepository.listarPorTenant(barbeariaJr.tenantId);
    const consumidoresBastiao = consumidorRepository.listarPorTenant(barbeiroBastiao.tenantId);

    const rodrigoNavalha = consumidoresNavalha.find((c) => c.whatsapp === "(11) 98123-4503");
    const rodrigoJr = consumidoresJr.find((c) => c.whatsapp === "(11) 98123-4503");
    expect(rodrigoNavalha).toBeDefined();
    expect(rodrigoJr).toBeDefined();
    expect(rodrigoNavalha!.id).not.toBe(rodrigoJr!.id);

    // Nenhum consumidor da Barbearia JR aparece no Barbeiro Bastião.
    const idsBastiao = new Set(consumidoresBastiao.map((c) => c.id));
    expect(consumidoresJr.some((c) => idsBastiao.has(c.id))).toBe(false);
  });

  it("'qualquer profissional' só é resolvido dentro da lista de candidatos do tenant atual", () => {
    // A função pura do motor (encontrarProfissionalDisponivel) já é testada em
    // engine.test.ts; aqui garantimos que a lista de candidatos que o app monta
    // para um tenant não inclui profissionais de outro tenant.
    const domNavalha = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    const clinica = estabelecimentoRepository.obterPorSlug("clinica-sorriso-leve")!;

    const profissionaisNavalha = profissionalRepository.listarPorTenant(domNavalha.tenantId);
    const profissionaisClinica = profissionalRepository.listarPorTenant(clinica.tenantId);

    const idsClinica = new Set(profissionaisClinica.map((p) => p.id));
    expect(profissionaisNavalha.some((p) => idsClinica.has(p.id))).toBe(false);
  });
});

describe("restaurarTenant", () => {
  it("restaura somente o tenant informado e preserva os dados do outro tenant intactos", () => {
    const domNavalha = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    const clinica = estabelecimentoRepository.obterPorSlug("clinica-sorriso-leve")!;

    // Simula edições: o dono da barbearia muda o nome público, e um novo
    // profissional é cadastrado na clínica.
    estabelecimentoRepository.atualizar(domNavalha.tenantId, {
      identidadeVisual: { ...domNavalha.identidadeVisual, nome: "Nome Editado Pelo Dono" },
    });
    const novoProfissionalClinica = profissionalRepository.criar({
      tenantId: clinica.tenantId,
      nome: "Novo Dentista de Teste",
      avatarIniciais: "ND",
      corAvatar: "#123456",
      servicosIds: [],
      horarios: [],
      agendamentoOnlineAtivo: true,
      ativo: true,
    });

    restaurarTenant(domNavalha.tenantId);

    const domNavalhaRestaurada = estabelecimentoRepository.obterPorTenantId(domNavalha.tenantId);
    expect(domNavalhaRestaurada?.identidadeVisual.nome).toBe("Barbearia Dom Navalha");

    // O profissional criado na clínica não pode ter sido apagado pela restauração
    // da barbearia — restaurarTenant nunca deve tocar em dados de outro tenant.
    const profissionaisClinicaAposRestauro = profissionalRepository.listarPorTenant(clinica.tenantId);
    expect(profissionaisClinicaAposRestauro.some((p) => p.id === novoProfissionalClinica.id)).toBe(true);

    const clinicaAposRestauro = estabelecimentoRepository.obterPorTenantId(clinica.tenantId);
    expect(clinicaAposRestauro?.identidadeVisual.nome).toBe("Clínica Sorriso Leve");
  });
});

function proximoDiaDeTrabalho(diasFuncionamento: DiaSemana[]): Date {
  let cursor = 1;
  while (cursor < 30) {
    const candidato = addDays(new Date(), cursor);
    if (diasFuncionamento.includes(getDay(candidato) as DiaSemana)) return candidato;
    cursor += 1;
  }
  throw new Error("Não achou um dia de funcionamento nos próximos 30 dias — configuração de teste inválida.");
}

describe("motor de disponibilidade funciona igualmente para os dois nichos", () => {
  it("calcula horários livres tanto para um barbeiro quanto para um dentista", () => {
    const domNavalha = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    const clinica = estabelecimentoRepository.obterPorSlug("clinica-sorriso-leve")!;

    const barbeiro = profissionalRepository.listarPorTenant(domNavalha.tenantId)[0];
    const servicoBarbearia = servicoRepository
      .listarPorTenant(domNavalha.tenantId)
      .find((s) => barbeiro.servicosIds.includes(s.id))!;
    const diaBarbearia = proximoDiaDeTrabalho(domNavalha.horarioGeral.diasFuncionamento);
    const horariosBarbearia = horariosLivresDoProfissionalNoDia(barbeiro, servicoBarbearia, diaBarbearia, domNavalha);

    const dentista = profissionalRepository.listarPorTenant(clinica.tenantId)[0];
    const procedimento = servicoRepository
      .listarPorTenant(clinica.tenantId)
      .find((s) => dentista.servicosIds.includes(s.id))!;
    const diaClinica = proximoDiaDeTrabalho(clinica.horarioGeral.diasFuncionamento);
    const horariosClinica = horariosLivresDoProfissionalNoDia(dentista, procedimento, diaClinica, clinica);

    // O motor não conhece nicho: mesma função, mesma forma de retorno (array de
    // Date), para dados completamente diferentes.
    expect(Array.isArray(horariosBarbearia)).toBe(true);
    expect(Array.isArray(horariosClinica)).toBe(true);
    expect(horariosBarbearia.length).toBeGreaterThan(0);
    expect(horariosClinica.length).toBeGreaterThan(0);
  });
});
