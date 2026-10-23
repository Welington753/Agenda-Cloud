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
