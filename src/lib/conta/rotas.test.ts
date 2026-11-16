import { describe, expect, it } from "vitest";
import {
  ENCAMINHAMENTOS_CONTA_ANTIGA,
  agruparSecoes,
  emAreaSobConfiguracoes,
  emSecaoDoEstabelecimento,
  secoesDisponiveis,
} from "./rotas";

describe("Configurações", () => {
  it("o dono vê todas as seções; os demais, só as pessoais", () => {
    expect(secoesDisponiveis(true).map((s) => s.rotulo)).toEqual([
      "Estabelecimento",
      "Notificações",
      "Recebimentos",
      "Aparência",
      "Perfil e segurança",
    ]);
    expect(secoesDisponiveis(false).map((s) => s.rotulo)).toEqual(["Aparência", "Perfil e segurança"]);
  });

  it("o índice agrupa por assunto; quem não é dono só vê o grupo da própria conta", () => {
    expect(agruparSecoes(secoesDisponiveis(true)).map((g) => [g.titulo, g.secoes.map((s) => s.href)])).toEqual([
      ["Estabelecimento", ["/conta/configuracoes/estabelecimento", "/conta/configuracoes/notificacoes"]],
      ["Financeiro", ["/conta/recebimentos"]],
      ["Sua conta", ["/conta/configuracoes/aparencia", "/conta/configuracoes/perfil"]],
    ]);
    expect(agruparSecoes(secoesDisponiveis(false)).map((g) => g.titulo)).toEqual(["Sua conta"]);
  });

  it("Equipe e acessos virou área do menu: sai das seções, no mesmo endereço e só do dono", () => {
    expect(secoesDisponiveis(true).map((s) => s.href)).not.toContain("/conta/configuracoes/equipe");
    expect(emAreaSobConfiguracoes("/conta/configuracoes/equipe")).toBe(true);
    expect(emSecaoDoEstabelecimento("/conta/configuracoes/equipe")).toBe(true);
  });

  it("Recebimentos entra no índice sem virar página só do dono (o gerente com a área continua abrindo)", () => {
    expect(emSecaoDoEstabelecimento("/conta/recebimentos")).toBe(false);
    expect(emAreaSobConfiguracoes("/conta/recebimentos")).toBe(false);
  });

  it("reconhece as seções do estabelecimento, inclusive subpáginas, sem confundir prefixos", () => {
    expect(emSecaoDoEstabelecimento("/conta/configuracoes/profissionais/p1/horarios")).toBe(true);
    expect(emSecaoDoEstabelecimento("/conta/configuracoes/equipe")).toBe(true);
    expect(emSecaoDoEstabelecimento("/conta/configuracoes/perfil")).toBe(false);
    expect(emSecaoDoEstabelecimento("/conta/configuracoes")).toBe(false);
    expect(emSecaoDoEstabelecimento("/conta/configuracoes/servicos-x")).toBe(false);
  });

  it("Serviços e Profissionais saem das seções, mas continuam só do dono", () => {
    expect(secoesDisponiveis(true).map((s) => s.href)).not.toContain("/conta/configuracoes/servicos");
    expect(emSecaoDoEstabelecimento("/conta/configuracoes/servicos")).toBe(true);
    expect(emAreaSobConfiguracoes("/conta/configuracoes/servicos")).toBe(true);
    expect(emAreaSobConfiguracoes("/conta/configuracoes/profissionais/p1/disponibilidade")).toBe(true);
    expect(emAreaSobConfiguracoes("/conta/configuracoes/notificacoes")).toBe(false);
    expect(emAreaSobConfiguracoes("/conta/configuracoes/servicos-x")).toBe(false);
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
