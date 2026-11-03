import { describe, expect, it } from "vitest";
import {
  ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA,
  ROTA_ESTABELECIMENTOS_ADMINISTRADOS,
  emAdministracao,
  rotaFichaEstabelecimento,
} from "./rotas";

describe("rotas do portal da plataforma", () => {
  it("ficam numa área própria, fora da operação dos estabelecimentos", () => {
    expect(ROTA_ESTABELECIMENTOS_ADMINISTRADOS).toBe("/plataforma/estabelecimentos");
    expect(rotaFichaEstabelecimento("t 1/2")).toBe("/plataforma/estabelecimentos/t%201%2F2");
  });

  it("reconhece só as páginas do portal", () => {
    expect(emAdministracao("/plataforma")).toBe(true);
    expect(emAdministracao("/plataforma/estabelecimentos/t1")).toBe(true);
    expect(emAdministracao("/plataforma-antiga")).toBe(false);
    expect(emAdministracao("/conta/administracao")).toBe(false);
    expect(emAdministracao("/conta/agendamentos")).toBe(false);
    expect(emAdministracao(null)).toBe(false);
  });

  it("encaminha os endereços antigos sem perder o caminho", () => {
    expect(ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA).toEqual([
      { source: "/plataforma", destination: "/plataforma/estabelecimentos", permanent: false },
      { source: "/administracao", destination: "/plataforma/estabelecimentos", permanent: false },
      { source: "/administracao/:caminho+", destination: "/plataforma/:caminho+", permanent: false },
      { source: "/conta/administracao", destination: "/plataforma/estabelecimentos", permanent: false },
      { source: "/conta/administracao/:caminho+", destination: "/plataforma/:caminho+", permanent: false },
    ]);
  });
});

describe("seções do portal", () => {
  it("menu na ordem pedida, todas dentro do portal", async () => {
    const { SECOES_ADMINISTRACAO, secaoAtiva } = await import("./rotas");
    expect(SECOES_ADMINISTRACAO.map((s) => s.rotulo)).toEqual([
      "Estabelecimentos",
      "Responsáveis e acessos",
      "Convites",
      "Planos e preços",
      "Pagamentos das assinaturas",
      "Proprietários da plataforma",
      "Histórico administrativo",
    ]);
    expect(SECOES_ADMINISTRACAO.every((s) => s.href.startsWith("/plataforma/"))).toBe(true);
    expect(secaoAtiva("/plataforma/usuarios/u1", "/plataforma/usuarios")).toBe(true);
    expect(secaoAtiva("/plataforma/usuarios-x", "/plataforma/usuarios")).toBe(false);
  });
});
