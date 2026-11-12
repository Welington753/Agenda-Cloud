import { describe, expect, it } from "vitest";
import { ehAcesso, type AcessoPlataforma } from "./contratos";
import {
  codigoDeRecuperacaoCompleto,
  codigoDoAplicativoCompleto,
  convidarParaAtivar,
  etapaDoPortao,
  limparCodigoDeRecuperacao,
  limparCodigoDoAplicativo,
  mensagemDaFalha,
  textoDosCodigos,
} from "./segundo-fator";

const caps = { viewDirectory: true, manageEstablishments: true, managePlatformAccess: true, manageEstablishmentLifecycle: true };
const nenhuma = { viewDirectory: false, manageEstablishments: false, managePlatformAccess: false, manageEstablishmentLifecycle: false };
const sf = (state: string, extra: Record<string, unknown> = {}) => ({
  state,
  enrollmentPermitted: false,
  recoveryPending: false,
  verifiedUntil: null,
  ...extra,
});

describe("portão do portal com o segundo fator", () => {
  it("o servidor decide: verificar, cadastrar, conteúdo ou sem acesso", () => {
    const acesso = (canView: boolean, secondFactor: unknown) =>
      ({ canViewEstablishments: canView, capabilities: canView ? caps : nenhuma, secondFactor }) as AcessoPlataforma;
    expect(etapaDoPortao(acesso(false, sf("VERIFICATION_REQUIRED")))).toBe("verificar");
    expect(etapaDoPortao(acesso(false, sf("ENROLLMENT_REQUIRED")))).toBe("cadastrar");
    expect(etapaDoPortao(acesso(true, sf("VERIFIED")))).toBe("conteudo");
    expect(etapaDoPortao(acesso(true, sf("ENROLLMENT_OPTIONAL")))).toBe("conteudo");
    expect(etapaDoPortao(acesso(false, null))).toBe("sem-acesso");
    // API anterior ao segundo fator: decide só pelo acesso, como antes.
    expect(etapaDoPortao(acesso(true, undefined))).toBe("conteudo");
    expect(convidarParaAtivar(acesso(true, sf("ENROLLMENT_OPTIONAL")))).toBe(true);
    expect(convidarParaAtivar(acesso(true, sf("VERIFIED")))).toBe(false);
  });

  it("contrato do acesso: estado desconhecido ou incompleto é recusado (nunca vira portal liberado)", () => {
    const base = { canViewEstablishments: false, capabilities: nenhuma };
    expect(ehAcesso({ ...base, secondFactor: sf("VERIFICATION_REQUIRED") })).toBe(true);
    expect(ehAcesso({ ...base, secondFactor: null })).toBe(true);
    expect(ehAcesso(base)).toBe(true);
    expect(ehAcesso({ ...base, secondFactor: sf("DESLIGADO") })).toBe(false);
    expect(ehAcesso({ ...base, secondFactor: { state: "VERIFIED" } })).toBe(false);
    expect(ehAcesso({ ...base, secondFactor: sf("VERIFIED", { verifiedUntil: "amanhã" }) })).toBe(false);
  });
});

describe("campos de código", () => {
  it("código do aplicativo: colar com espaço, hífen ou texto em volta", () => {
    expect(limparCodigoDoAplicativo("123 456")).toBe("123456");
    expect(limparCodigoDoAplicativo("Seu código: 123-456.")).toBe("123456");
    expect(limparCodigoDoAplicativo("1234567890")).toBe("123456");
    expect(codigoDoAplicativoCompleto("123456")).toBe(true);
    expect(codigoDoAplicativoCompleto("12345")).toBe(false);
  });

  it("código de recuperação: minúsculas e espaços ao colar", () => {
    expect(limparCodigoDeRecuperacao(" abcd-efgh-ijkl-mnop ")).toBe("ABCD-EFGH-IJKL-MNOP");
    expect(codigoDeRecuperacaoCompleto("ABCD-EFGH-IJKL-MNOP")).toBe(true);
    expect(codigoDeRecuperacaoCompleto("ABCDEFGHIJKLMNOP")).toBe(true);
    expect(codigoDeRecuperacaoCompleto("ABCD-EFGH")).toBe(false);
  });

  it("arquivo dos códigos: todos os códigos, sem nada além do e-mail da conta", () => {
    const texto = textoDosCodigos(["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"], "pessoa@example.test", new Date("2031-01-15T12:00:00Z"));
    expect(texto).toContain("AAAA-BBBB-CCCC-DDDD");
    expect(texto).toContain("EEEE-FFFF-GGGG-HHHH");
    expect(texto).toContain("Conta: pessoa@example.test");
    expect(texto).toContain("2031-01-15");
    expect(textoDosCodigos(["AAAA-BBBB-CCCC-DDDD"], null, new Date())).not.toContain("Conta:");
  });

  it("mensagens não repetem o código e dizem o tempo da trava", () => {
    expect(mensagemDaFalha({ tipo: "bloqueado", segundos: 600 })).toMatch(/10 minutos/);
    expect(mensagemDaFalha({ tipo: "bloqueado", segundos: 30 })).toMatch(/1 minuto\b/);
    expect(mensagemDaFalha({ tipo: "codigo-invalido" })).toMatch(/incorreto/);
    expect(mensagemDaFalha({ tipo: "indisponivel" })).toMatch(/recuperação/);
  });
});
