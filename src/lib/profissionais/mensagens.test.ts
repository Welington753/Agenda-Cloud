import { describe, expect, it } from "vitest";
import { mensagemFalhaProfissionais } from "./mensagens";

describe("mensagemFalhaProfissionais", () => {
  it("distingue sem acesso de sem permissão", () => {
    expect(mensagemFalhaProfissionais({ tipo: "sem_acesso" })).toContain("não tem acesso");
    expect(mensagemFalhaProfissionais({ tipo: "sem_permissao" })).toContain("não tem permissão");
  });

  it("sessão expirada orienta a entrar de novo", () => {
    expect(mensagemFalhaProfissionais({ tipo: "nao_autenticado" })).toContain("sessão expirou");
  });

  it("falha de comunicação NUNCA afirma que a alteração não foi salva", () => {
    const mensagem = mensagemFalhaProfissionais({ tipo: "falha_comunicacao" });
    expect(mensagem).toContain("conferir");
    expect(mensagem).not.toMatch(/não foi salva|nada foi salvo|nenhuma alteração/i);
  });

  it("usa a mensagem do backend no 400 e um texto próprio quando não vem nenhuma", () => {
    expect(
      mensagemFalhaProfissionais({ tipo: "dados_invalidos", mensagem: "Campos com problema: name." }),
    ).toContain("name");
    expect(mensagemFalhaProfissionais({ tipo: "dados_invalidos", mensagem: null })).toContain("Revise");
  });

  it("conflito de vínculo concorrente orienta a atualizar a lista", () => {
    expect(mensagemFalhaProfissionais({ tipo: "conflito" })).toContain("Atualize a lista");
  });

  it("indisponibilidade não é confundida com dado errado", () => {
    expect(mensagemFalhaProfissionais({ tipo: "indisponivel" })).toContain(
      "Tente novamente em instantes",
    );
  });
});
