import { describe, expect, it } from "vitest";
import {
  formularioInicial,
  itensDoCatalogo,
  mensagemDeSucesso,
  textoDaDisponibilidade,
  validarItem,
  type ItemDoCatalogo,
} from "./catalogo-modular";
import type { CatalogoAssinatura } from "./assinatura";

// Preços de EXEMPLO, nunca aprovados.
const catalogo: CatalogoAssinatura = {
  basePriceCents: 2990,
  basePlanId: "plan_modular",
  essential: { planId: "plan_modular", name: "Agenda base", description: "Agenda e equipe.", priceCents: 2990 },
  addons: [
    { code: "COMISSOES", name: "Comissões", description: "Regras de comissão.", featureKey: "COMISSOES", availability: "AVAILABLE", priceCents: 1490 },
    { code: "MARKETING", name: "Marketing", description: "Campanhas.", featureKey: null, availability: "PLANNED", priceCents: null },
    { code: "WHATSAPP", name: "WhatsApp", description: "Lembretes.", featureKey: null, availability: "IN_DEVELOPMENT", priceCents: null },
  ],
  history: [],
  canManage: true,
};

const [essencial, comissoes, marketing, whatsapp] = itensDoCatalogo(catalogo);

describe("itensDoCatalogo", () => {
  it("essencial primeiro, com o nome atual, e todos os adicionais, inclusive os planejados", () => {
    expect(itensDoCatalogo(catalogo).map((i) => [i.code, i.name, i.caminho])).toEqual([
      ["plan_modular", "Agenda base", "/platform/catalog/essential"],
      ["COMISSOES", "Comissões", "/platform/catalog/addons/COMISSOES"],
      ["MARKETING", "Marketing", "/platform/catalog/addons/MARKETING"],
      ["WHATSAPP", "WhatsApp", "/platform/catalog/addons/WHATSAPP"],
    ]);
  });

  it("diz quando o item não pode ser contratado", () => {
    expect(textoDaDisponibilidade(essencial)).toContain("base obrigatória");
    expect(textoDaDisponibilidade(comissoes)).toBe("Disponível para contratação.");
    expect(textoDaDisponibilidade(marketing)).toBe("Não pode ser contratado enquanto estiver planejado.");
    expect(textoDaDisponibilidade(whatsapp)).toBe("Não pode ser contratado enquanto estiver em desenvolvimento.");
  });
});

describe("validarItem", () => {
  const editar = (item: ItemDoCatalogo, mudanca: Partial<ReturnType<typeof formularioInicial>>) =>
    validarItem(item, { ...formularioInicial(item), ...mudanca });

  it("sem mudança não envia nada", () => {
    expect(editar(comissoes, {})).toEqual({ erros: {}, mudou: false, corpo: null });
    expect(editar(comissoes, { nome: "  Comissões  ", preco: "14,9" })).toMatchObject({ mudou: false, corpo: null });
  });

  it("monta o corpo com o que a tela leu e os valores novos, sem espaços extras", () => {
    expect(editar(comissoes, { nome: " Comissões por serviço ", preco: "15,90", motivo: " Reajuste " }).corpo).toEqual({
      expected: { name: "Comissões", description: "Regras de comissão.", priceCents: 1490 },
      name: "Comissões por serviço",
      description: "Regras de comissão.",
      priceCents: 1590,
      reason: "Reajuste",
    });
  });

  it("planejado: muda o nome mantendo o preço a definir, ou define o preço", () => {
    expect(editar(marketing, { nome: "Marketing e fidelização" }).corpo).toMatchObject({ priceCents: null, name: "Marketing e fidelização" });
    expect(editar(marketing, { preco: "19,90" }).corpo).toMatchObject({ priceCents: 1990 });
  });

  it("valida nome, descrição, preço e motivo com mensagens claras", () => {
    expect(editar(comissoes, { nome: " a " }).erros.nome).toMatch(/pelo menos 2/);
    expect(editar(comissoes, { nome: "x".repeat(81) }).erros.nome).toMatch(/até 80/);
    expect(editar(comissoes, { descricao: "ab" }).erros.descricao).toMatch(/pelo menos 3/);
    expect(editar(comissoes, { descricao: "x".repeat(301) }).erros.descricao).toMatch(/até 300/);
    expect(editar(comissoes, { preco: "abc" }).erros.preco).toMatch(/Valor inválido/);
    expect(editar(comissoes, { preco: "0" }).erros.preco).toMatch(/Valor inválido/);
    expect(editar(comissoes, { preco: "1000000,01" }).erros.preco).toMatch(/máximo/);
    expect(editar(comissoes, { preco: "" }).erros.preco).toMatch(/não volta a ficar pendente/);
    expect(editar(comissoes, { nome: "Outro", motivo: "ok" }).erros.motivo).toMatch(/pelo menos 3/);
    expect(editar(comissoes, { nome: "a" }).corpo).toBeNull();
  });

  it("essencial também é editável e continua sendo o essencial", () => {
    const r = editar(essencial, { nome: "Agendamento", descricao: "Agenda, link e equipe." });
    expect(r.corpo).toMatchObject({ name: "Agendamento", description: "Agenda, link e equipe.", priceCents: 2990 });
  });
});

describe("mensagemDeSucesso", () => {
  it("avisa que assinaturas existentes não mudam quando o preço muda", () => {
    const corpo = editar2(comissoes, "15,90");
    expect(mensagemDeSucesso(comissoes, corpo)).toBe(
      "Comissões atualizado no catálogo. O novo preço vale para as próximas contratações; assinaturas existentes não mudam.",
    );
    expect(mensagemDeSucesso(comissoes, { ...corpo, priceCents: 1490 })).toBe("Comissões atualizado no catálogo.");
  });
});

function editar2(item: ItemDoCatalogo, preco: string) {
  return validarItem(item, { ...formularioInicial(item), preco }).corpo!;
}
