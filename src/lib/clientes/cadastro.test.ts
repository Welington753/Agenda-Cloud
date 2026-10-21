import { describe, expect, it } from "vitest";
import {
  mensagemFalhaBusca,
  mensagemFalhaCadastro,
  paraDadosCliente,
  validarCliente,
} from "./cadastro";

const VALIDO = { nome: "Maria Souza", whatsapp: "(11) 90000-0000", email: "" };

describe("validarCliente", () => {
  it("aceita nome e WhatsApp com DDD, e-mail opcional", () => {
    expect(validarCliente(VALIDO)).toEqual({});
    expect(validarCliente({ ...VALIDO, email: "maria@example.com" })).toEqual({});
  });

  it("exige nome e WhatsApp, em português", () => {
    expect(validarCliente({ nome: "  ", whatsapp: "", email: "" })).toEqual({
      nome: "Informe o nome do cliente.",
      whatsapp: "Informe o WhatsApp do cliente.",
    });
  });

  it("espelha normalizePhone: 10 a 13 dígitos", () => {
    expect(validarCliente({ ...VALIDO, whatsapp: "123456789" }).whatsapp).toBe(
      "Informe um telefone válido com DDD.",
    );
    expect(validarCliente({ ...VALIDO, whatsapp: "+55 11 90000-0000" })).toEqual({});
    expect(validarCliente({ ...VALIDO, whatsapp: "12345678901234" }).whatsapp).toBeDefined();
  });

  it("recusa e-mail malformado e limites do DTO", () => {
    expect(validarCliente({ ...VALIDO, email: "maria@" }).email).toBe("Informe um e-mail válido.");
    expect(validarCliente({ ...VALIDO, nome: "a".repeat(121) }).nome).toMatch(/120/);
  });
});

describe("paraDadosCliente", () => {
  it("apara os campos e omite e-mail vazio", () => {
    expect(paraDadosCliente({ nome: " Ana ", whatsapp: " 11999990000 ", email: "  " })).toEqual({
      name: "Ana",
      whatsapp: "11999990000",
    });
    expect(paraDadosCliente({ ...VALIDO, email: " a@b.co " }).email).toBe("a@b.co");
  });
});

describe("mensagens", () => {
  it("falha de comunicação no cadastro é INCERTA e manda pesquisar antes", () => {
    const texto = mensagemFalhaCadastro({ tipo: "falha_comunicacao" });
    expect(texto).toMatch(/pode ter sido cadastrado/);
    expect(texto).toMatch(/pesquise/);
  });

  it("duplicidade usa a mensagem do servidor ou um padrão", () => {
    expect(mensagemFalhaCadastro({ tipo: "duplicado", mensagem: "Do servidor" })).toBe("Do servidor");
    expect(mensagemFalhaCadastro({ tipo: "duplicado", mensagem: null })).toMatch(/Já existe/);
  });

  it("busca diferencia permissão de comunicação", () => {
    expect(mensagemFalhaBusca({ tipo: "sem_permissao" })).toMatch(/permissão/);
    expect(mensagemFalhaBusca({ tipo: "falha_comunicacao" })).toMatch(/servidor/);
  });
});
