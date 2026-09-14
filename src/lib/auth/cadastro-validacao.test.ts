// A referência destes testes é `backend/src/auth/register.dto.ts` — se o
// cliente aceitasse algo que o DTO recusa, o usuário só descobriria depois de
// uma ida à rede; se recusasse algo que o DTO aceita, o cadastro ficaria
// impossível sem motivo. Os dois lados são checados abaixo.
import { describe, expect, it } from "vitest";
import {
  SENHA_MAX,
  SENHA_MIN,
  formularioEhValido,
  paraDadosCadastro,
  validarCadastro,
  type FormularioCadastro,
} from "./cadastro-validacao";

const VALIDO: FormularioCadastro = {
  ownerName: "Maria Souza",
  businessName: "Studio Bela",
  email: "maria@example.com",
  phone: "(11) 99999-8888",
  password: "senha-com-dez+",
};

function com(campos: Partial<FormularioCadastro>): FormularioCadastro {
  return { ...VALIDO, ...campos };
}

describe("validarCadastro", () => {
  it("aceita o formulário mínimo exigido pelo contrato", () => {
    expect(validarCadastro(VALIDO)).toEqual({});
    expect(formularioEhValido(validarCadastro(VALIDO))).toBe(true);
  });

  it("exige todos os campos do DTO quando o formulário está vazio", () => {
    const erros = validarCadastro({ ownerName: "", businessName: "", email: "", phone: "", password: "" });
    expect(Object.keys(erros).sort()).toEqual(["businessName", "email", "ownerName", "password", "phone"]);
  });

  it("rejeita nome e estabelecimento com menos de 2 caracteres (min(2) do DTO)", () => {
    expect(validarCadastro(com({ ownerName: "M" })).ownerName).toBeTruthy();
    expect(validarCadastro(com({ businessName: "S" })).businessName).toBeTruthy();
  });

  it("rejeita nome e estabelecimento acima de 120 caracteres (max(120) do DTO)", () => {
    const longo = "a".repeat(121);
    expect(validarCadastro(com({ ownerName: longo })).ownerName).toBeTruthy();
    expect(validarCadastro(com({ businessName: longo })).businessName).toBeTruthy();
  });

  it("considera o valor já sem espaços das pontas, como o `.trim()` do DTO", () => {
    expect(validarCadastro(com({ ownerName: "   " })).ownerName).toBeTruthy();
    expect(validarCadastro(com({ ownerName: "  Maria Souza  " })).ownerName).toBeUndefined();
  });

  it("rejeita e-mail sem formato e acima de 254 caracteres", () => {
    expect(validarCadastro(com({ email: "maria" })).email).toBeTruthy();
    expect(validarCadastro(com({ email: "maria@exemplo" })).email).toBeTruthy();
    expect(validarCadastro(com({ email: `${"a".repeat(250)}@example.com` })).email).toBeTruthy();
  });

  it("aceita telefone entre 10 e 13 dígitos, ignorando formatação (igual a normalizePhone)", () => {
    expect(validarCadastro(com({ phone: "1199998888" })).phone).toBeUndefined();
    expect(validarCadastro(com({ phone: "+55 (11) 99999-8888" })).phone).toBeUndefined();
    expect(validarCadastro(com({ phone: "999998888" })).phone).toBeTruthy();
    expect(validarCadastro(com({ phone: "12345678901234" })).phone).toBeTruthy();
  });

  it("exige apenas comprimento da senha — nunca símbolo, número ou maiúscula", () => {
    expect(validarCadastro(com({ password: "a".repeat(SENHA_MIN - 1) })).password).toBeTruthy();
    expect(validarCadastro(com({ password: "a".repeat(SENHA_MIN) })).password).toBeUndefined();
    expect(validarCadastro(com({ password: "a".repeat(SENHA_MAX) })).password).toBeUndefined();
    expect(validarCadastro(com({ password: "a".repeat(SENHA_MAX + 1) })).password).toBeTruthy();
  });
});

describe("paraDadosCadastro", () => {
  it("normaliza exatamente o que o DTO normaliza (trim e e-mail em minúsculas)", () => {
    const dados = paraDadosCadastro(
      com({ ownerName: "  Maria Souza ", businessName: " Studio Bela ", email: "  Maria@Example.COM " }),
    );

    expect(dados.ownerName).toBe("Maria Souza");
    expect(dados.businessName).toBe("Studio Bela");
    expect(dados.email).toBe("maria@example.com");
  });

  it("nunca altera a senha — `trim` nela mudaria a credencial digitada", () => {
    const dados = paraDadosCadastro(com({ password: "  senha com espaco  " }));
    expect(dados.password).toBe("  senha com espaco  ");
  });

  it("envia só os cinco campos do contrato, nenhum campo inventado", () => {
    expect(Object.keys(paraDadosCadastro(VALIDO)).sort()).toEqual([
      "businessName",
      "email",
      "ownerName",
      "password",
      "phone",
    ]);
  });
});
