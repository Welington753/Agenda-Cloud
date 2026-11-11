import { describe, expect, it } from "vitest";
import {
  ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA,
  ROTA_ESTABELECIMENTOS_ADMINISTRADOS,
  ROTA_VISAO_GERAL,
  destinoNoPortal,
  emAdministracao,
  entradaDoPortal,
  rotaEstabelecimentosFiltrados,
  rotaFichaEstabelecimento,
} from "./rotas";

describe("rotas do portal da plataforma", () => {
  it("ficam numa área própria, fora da operação dos estabelecimentos", () => {
    expect(ROTA_ESTABELECIMENTOS_ADMINISTRADOS).toBe("/portal/estabelecimentos");
    expect(rotaFichaEstabelecimento("t 1/2")).toBe("/portal/estabelecimentos/t%201%2F2");
    expect(ROTA_VISAO_GERAL).toBe("/portal/visao-geral");
  });

  it("links da Visão geral abrem a listagem já filtrada", () => {
    expect(rotaEstabelecimentosFiltrados({})).toBe("/portal/estabelecimentos");
    expect(rotaEstabelecimentosFiltrados({ filtro: "EXPIRING_SOON" })).toBe("/portal/estabelecimentos?filtro=EXPIRING_SOON");
    expect(rotaEstabelecimentosFiltrados({ situacao: "SUSPENDED" })).toBe("/portal/estabelecimentos?situacao=SUSPENDED");
    // Alcance: o padrão (clientes) não aparece; os outros seguem para a lista.
    expect(rotaEstabelecimentosFiltrados({ alcance: "CLIENTS" })).toBe("/portal/estabelecimentos");
    expect(rotaEstabelecimentosFiltrados({ alcance: "INTERNAL", filtro: "EXPIRING_SOON" })).toBe(
      "/portal/estabelecimentos?alcance=INTERNAL&filtro=EXPIRING_SOON",
    );
    expect(rotaEstabelecimentosFiltrados({ alcance: "ALL" })).toBe("/portal/estabelecimentos?alcance=ALL");
  });

  it("reconhece só as páginas do portal", () => {
    expect(emAdministracao("/portal")).toBe(true);
    expect(emAdministracao("/portal/estabelecimentos/t1")).toBe(true);
    expect(emAdministracao("/portal-antigo")).toBe(false);
    expect(emAdministracao("/plataforma")).toBe(false);
    expect(emAdministracao("/conta/administracao")).toBe(false);
    expect(emAdministracao("/conta/agendamentos")).toBe(false);
    expect(emAdministracao(null)).toBe(false);
  });

  it("encaminha os endereços antigos para a entrada ou para a mesma página do portal", () => {
    expect(ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA).toEqual([
      { source: "/plataforma", destination: "/portal", permanent: false },
      { source: "/plataforma/:caminho+", destination: "/portal/:caminho+", permanent: false },
      { source: "/administracao", destination: "/portal", permanent: false },
      { source: "/administracao/:caminho+", destination: "/portal/:caminho+", permanent: false },
      { source: "/conta/administracao", destination: "/portal", permanent: false },
      { source: "/conta/administracao/:caminho+", destination: "/portal/:caminho+", permanent: false },
    ]);
  });
});

describe("entrada do portal", () => {
  it("depois do login, segue só um destino de dentro do portal", () => {
    expect(destinoNoPortal(null)).toBe("/portal/visao-geral");
    expect(destinoNoPortal("/portal/usuarios/u1?aba=acesso")).toBe("/portal/usuarios/u1?aba=acesso");
    expect(destinoNoPortal("/conta/visao-geral")).toBe("/portal/visao-geral");
    expect(destinoNoPortal("/portal-falso/x")).toBe("/portal/visao-geral");
    // A própria entrada não vira destino: voltaria ao formulário.
    expect(destinoNoPortal("/portal")).toBe("/portal/visao-geral");
    expect(destinoNoPortal("/portal?next=/portal")).toBe("/portal/visao-geral");
  });

  it("sessão expirada no portal volta para a entrada do portal, não para o login da operação", () => {
    expect(entradaDoPortal("/portal/papeis")).toBe("/portal?next=%2Fportal%2Fpapeis");
    expect(entradaDoPortal("/portal/usuarios?busca=a b")).toBe("/portal?next=%2Fportal%2Fusuarios%3Fbusca%3Da%20b");
    expect(entradaDoPortal(null)).toBe("/portal");
    expect(entradaDoPortal("/conta/agendamentos")).toBe("/portal");
  });
});

describe("seções do portal", () => {
  it("menu na ordem pedida, todas dentro do portal", async () => {
    const { SECOES_ADMINISTRACAO, secaoAtiva } = await import("./rotas");
    expect(SECOES_ADMINISTRACAO.map((s) => s.rotulo)).toEqual([
      "Visão geral",
      "Estabelecimentos",
      "Responsáveis e acessos",
      "Convites",
      "Planos e preços",
      "Pagamentos das assinaturas",
      "Proprietários da plataforma",
      "Histórico administrativo",
    ]);
    expect(SECOES_ADMINISTRACAO.every((s) => s.href.startsWith("/portal/"))).toBe(true);
    expect(secaoAtiva("/portal/usuarios/u1", "/portal/usuarios")).toBe(true);
    expect(secaoAtiva("/portal/usuarios-x", "/portal/usuarios")).toBe(false);
  });
});
