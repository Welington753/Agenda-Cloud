import { describe, expect, it } from "vitest";
import { ENCAMINHAMENTOS_CONTA_ANTIGA, emSecaoDoEstabelecimento, secoesDisponiveis } from "./rotas";

describe("Configurações", () => {
  it("o dono vê todas as seções; os demais, só as pessoais", () => {
    expect(secoesDisponiveis(true).map((s) => s.rotulo)).toEqual([
      "Estabelecimento",
      "Serviços",
      "Profissionais",
      "Equipe e acessos",
      "Notificações",
      "Aparência",
      "Perfil e segurança",
    ]);
    expect(secoesDisponiveis(false).map((s) => s.rotulo)).toEqual(["Aparência", "Perfil e segurança"]);
  });

  it("reconhece as seções do estabelecimento, inclusive subpáginas, sem confundir prefixos", () => {
    expect(emSecaoDoEstabelecimento("/conta/configuracoes/profissionais/p1/horarios")).toBe(true);
    expect(emSecaoDoEstabelecimento("/conta/configuracoes/equipe")).toBe(true);
    expect(emSecaoDoEstabelecimento("/conta/configuracoes/perfil")).toBe(false);
    expect(emSecaoDoEstabelecimento("/conta/configuracoes")).toBe(false);
    expect(emSecaoDoEstabelecimento("/conta/configuracoes/servicos-x")).toBe(false);
  });
});

describe("endereços antigos", () => {
  it("cada endereço antigo leva ao novo, sem cache permanente", () => {
    expect(ENCAMINHAMENTOS_CONTA_ANTIGA.map((e) => [e.source, e.destination, e.permanent])).toEqual([
      ["/conta/solicitacoes", "/conta/agendamentos/solicitacoes", false],
      ["/conta/servicos", "/conta/configuracoes/servicos", false],
      ["/conta/profissionais", "/conta/configuracoes/profissionais", false],
      ["/conta/profissionais/:caminho*", "/conta/configuracoes/profissionais/:caminho*", false],
      ["/conta/equipe", "/conta/configuracoes/equipe", false],
    ]);
  });
});
