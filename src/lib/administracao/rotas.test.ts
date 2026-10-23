import { describe, expect, it } from "vitest";
import {
  ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA,
  ROTA_ESTABELECIMENTOS_ADMINISTRADOS,
  emAdministracao,
  rotaFichaEstabelecimento,
} from "./rotas";

describe("rotas da administração", () => {
  it("ficam dentro da área real", () => {
    expect(ROTA_ESTABELECIMENTOS_ADMINISTRADOS).toBe("/conta/administracao/estabelecimentos");
    expect(rotaFichaEstabelecimento("t 1/2")).toBe(
      "/conta/administracao/estabelecimentos/t%201%2F2",
    );
  });

  it("reconhece só as páginas da administração", () => {
    expect(emAdministracao("/conta/administracao")).toBe(true);
    expect(emAdministracao("/conta/administracao/estabelecimentos/t1")).toBe(true);
    expect(emAdministracao("/conta/administracao-antiga")).toBe(false);
    expect(emAdministracao("/conta/agendamentos")).toBe(false);
    expect(emAdministracao("/administracao")).toBe(false);
    expect(emAdministracao(null)).toBe(false);
  });

  it("encaminha os endereços antigos sem perder o caminho", () => {
    expect(ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA).toEqual([
      {
        source: "/administracao",
        destination: "/conta/administracao/estabelecimentos",
        permanent: false,
      },
      {
        source: "/conta/administracao",
        destination: "/conta/administracao/estabelecimentos",
        permanent: false,
      },
      {
        source: "/administracao/:caminho+",
        destination: "/conta/administracao/:caminho+",
        permanent: false,
      },
    ]);
  });
});

describe("seções da administração", () => {
  it("abas na ordem pedida, todas dentro da área real", async () => {
    const { SECOES_ADMINISTRACAO, secaoAtiva } = await import("./rotas");
    expect(SECOES_ADMINISTRACAO.map((s) => s.rotulo)).toEqual([
      "Estabelecimentos",
      "Usuários",
      "Convites",
      "Papéis e permissões",
      "Histórico",
    ]);
    expect(SECOES_ADMINISTRACAO.every((s) => s.href.startsWith("/conta/administracao/"))).toBe(true);
    expect(secaoAtiva("/conta/administracao/usuarios/u1", "/conta/administracao/usuarios")).toBe(true);
    expect(secaoAtiva("/conta/administracao/usuarios-x", "/conta/administracao/usuarios")).toBe(false);
  });
});
