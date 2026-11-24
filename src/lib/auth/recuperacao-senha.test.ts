import { describe, expect, it } from "vitest";
import {
  CONFIRMACAO_DO_PEDIDO,
  ORIENTACAO_LOGIN_SEM_EMAIL,
  entradaDaOrigem,
  erroDoIdentificador,
  erroDoPedido,
  linkEsqueciSenha,
  origemDaRecuperacao,
} from "./recuperacao-senha";

describe("origem e volta", () => {
  it("só ?origem=portal volta ao portal; o resto volta ao login", () => {
    expect(entradaDaOrigem(origemDaRecuperacao("portal"))).toBe("/portal");
    for (const valor of [null, undefined, "", "login", "https://exemplo.com", "/conta", "PORTAL"]) {
      expect(entradaDaOrigem(origemDaRecuperacao(valor))).toBe("/login");
    }
  });

  it("cada entrada aponta para a mesma tela, com a origem", () => {
    expect(linkEsqueciSenha("login")).toBe("/esqueci-senha");
    expect(linkEsqueciSenha("portal")).toBe("/esqueci-senha?origem=portal");
  });
});

describe("erroDoIdentificador", () => {
  it("aceita e-mail ou login; recusa vazio, espaço no meio e texto longo", () => {
    expect(erroDoIdentificador("  ana@example.test ")).toBeNull();
    expect(erroDoIdentificador("maria@salao")).toBeNull();
    expect(erroDoIdentificador("joao.silva")).toBeNull();
    expect(erroDoIdentificador("   ")).toBe("Informe seu e-mail ou login.");
    expect(erroDoIdentificador("ana silva")).toBe("O e-mail ou login não tem espaços.");
    expect(erroDoIdentificador("a".repeat(255))).toBe("Use no máximo 254 caracteres.");
  });
});

describe("textos que nunca revelam a conta", () => {
  it("a confirmação é condicional e serve para qualquer conta", () => {
    const texto = CONFIRMACAO_DO_PEDIDO.join(" ");
    expect(texto).toContain("Se o e-mail ou login informado for de uma conta com e-mail confirmado");
    expect(texto).toContain("Confira o prazo de validade no e-mail.");
    expect(texto).toContain("use a mensagem anterior");
    expect(texto).toContain("Um novo pedido não renova esse prazo.");
    expect(texto).not.toMatch(/não encontramos|não existe|enviamos para|conta encontrada/i);
  });

  it("a orientação para login sem e-mail é geral e aponta o responsável", () => {
    expect(ORIENTACAO_LOGIN_SEM_EMAIL).toContain("responsável pelo estabelecimento");
    expect(ORIENTACAO_LOGIN_SEM_EMAIL).not.toMatch(/sua conta (não|existe)/i);
  });

  it("erros só falam do envio, nunca da conta", () => {
    expect(erroDoPedido("limite")).toMatch(/Muitos pedidos/);
    expect(erroDoPedido("falha_comunicacao")).toMatch(/conectar/);
    expect(erroDoPedido("invalido")).toMatch(/Confira/);
    expect(erroDoPedido("indisponivel")).toMatch(/Tente de novo/);
  });
});
