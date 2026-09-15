import { describe, expect, it } from "vitest";
import { mensagemFalhaServicos } from "./mensagens";

describe("mensagemFalhaServicos", () => {
  it("distingue sem acesso de sem permissão", () => {
    expect(mensagemFalhaServicos({ tipo: "sem_acesso" })).toContain("não tem acesso");
    expect(mensagemFalhaServicos({ tipo: "sem_permissao" })).toContain("não tem permissão");
  });

  it("sessão expirada orienta a entrar de novo", () => {
    expect(mensagemFalhaServicos({ tipo: "nao_autenticado" })).toContain("sessão expirou");
  });

  it("falha de comunicação NUNCA afirma que a alteração não foi salva", () => {
    const mensagem = mensagemFalhaServicos({ tipo: "falha_comunicacao" });
    expect(mensagem).toContain("conferir");
    expect(mensagem).not.toMatch(/não foi salva|nada foi salvo|nenhuma alteração/i);
  });

  it("usa a mensagem do backend no 400 e um texto próprio quando não vem nenhuma", () => {
    expect(
      mensagemFalhaServicos({ tipo: "dados_invalidos", mensagem: "Campos com problema: name." }),
    ).toContain("name");
    expect(mensagemFalhaServicos({ tipo: "dados_invalidos", mensagem: null })).toContain("Revise");
  });

  it("indisponibilidade não é confundida com dado errado", () => {
    expect(mensagemFalhaServicos({ tipo: "indisponivel" })).toContain("Tente novamente em instantes");
  });
});
