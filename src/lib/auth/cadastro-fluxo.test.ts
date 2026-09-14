import { describe, expect, it } from "vitest";
import type { SessaoRealContexto } from "@/lib/api/auth-api";
import {
  MENSAGEM_SESSAO_PENDENTE,
  decidirFluxoCadastro,
  mensagemFalhaCadastro,
} from "./cadastro-fluxo";
import type { EstadoAutenticacaoReal } from "./real-session-state";

const SESSAO: SessaoRealContexto = {
  user: { id: "user_1", name: "Maria Souza", email: "maria@example.com" },
  contexts: [],
  activeContext: null,
  requiresTenantSelection: false,
  hasEstablishmentAccess: false,
};

const AUTENTICADO: EstadoAutenticacaoReal = { status: "autenticado", sessao: SESSAO, tenantIdAtivo: null };

describe("decidirFluxoCadastro", () => {
  it("cadastro confirmado + sessão carregada vira `concluido`", () => {
    expect(decidirFluxoCadastro(true, null, AUTENTICADO)).toEqual({ etapa: "concluido", sessao: SESSAO });
  });

  it("cadastro confirmado + /auth/me com falha de comunicação vira `sessao_pendente`, nunca `cadastro_falhou`", () => {
    expect(decidirFluxoCadastro(true, null, { status: "falha_comunicacao" })).toEqual({ etapa: "sessao_pendente" });
  });

  it("cadastro confirmado + /auth/me respondendo 401 vira `sessao_pendente` — a conta existe do mesmo jeito", () => {
    expect(decidirFluxoCadastro(true, null, { status: "nao_autenticado" })).toEqual({ etapa: "sessao_pendente" });
  });

  it("cadastro confirmado + resposta de /auth/me descartada (geração antiga) vira `sessao_pendente`", () => {
    expect(decidirFluxoCadastro(true, null, null)).toEqual({ etapa: "sessao_pendente" });
  });

  it("cadastro recusado preserva a falha original para a UI", () => {
    expect(decidirFluxoCadastro(false, { tipo: "email_em_uso" }, null)).toEqual({
      etapa: "cadastro_falhou",
      falha: { tipo: "email_em_uso" },
    });
  });

  it("nunca produz `concluido` quando o cadastro falhou, mesmo com um estado autenticado antigo", () => {
    expect(decidirFluxoCadastro(false, { tipo: "limite_tentativas" }, AUTENTICADO).etapa).toBe("cadastro_falhou");
  });
});

describe("mensagemFalhaCadastro", () => {
  it("e-mail já cadastrado é dito claramente, com saída para o login", () => {
    expect(mensagemFalhaCadastro({ tipo: "email_em_uso" })).toContain("já está cadastrado");
  });

  it("limite de tentativas orienta a esperar, nunca a tentar de novo agora", () => {
    expect(mensagemFalhaCadastro({ tipo: "limite_tentativas" })).toContain("Aguarde");
  });

  it("falha de comunicação NUNCA afirma que a conta não foi criada", () => {
    const mensagem = mensagemFalhaCadastro({ tipo: "falha_comunicacao" });
    expect(mensagem).toContain("pode ter sido criada");
    expect(mensagem).not.toMatch(/não foi criada|nenhuma conta|conta não/i);
  });

  it("usa a mensagem do backend no 400, e um texto próprio quando o corpo não trouxe nenhuma", () => {
    expect(mensagemFalhaCadastro({ tipo: "dados_invalidos", mensagem: "Dados inválidos. Campos com problema: email." }))
      .toContain("email");
    expect(mensagemFalhaCadastro({ tipo: "dados_invalidos", mensagem: null })).toContain("Revise os campos");
  });

  it("indisponibilidade da API não é confundida com dado errado do usuário", () => {
    expect(mensagemFalhaCadastro({ tipo: "indisponivel" })).toContain("Tente novamente em instantes");
  });
});

describe("MENSAGEM_SESSAO_PENDENTE", () => {
  it("afirma que a conta foi criada e desencoraja repetir o cadastro", () => {
    expect(MENSAGEM_SESSAO_PENDENTE).toContain("conta foi criada");
    expect(MENSAGEM_SESSAO_PENDENTE).toContain("não é preciso cadastrar de novo");
  });
});
