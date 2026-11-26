import { describe, expect, it } from "vitest";
import { concluirEnvio, formularioTravado, iniciarEnvio, novoEnvio, resultadoDesconhecido, type EstadoDoEnvio } from "./envio";

type Corpo = { requestKey: string; valor: number };

describe("envio com chave de pedido", () => {
  it("o primeiro envio usa a chave do formulário e o corpo proposto", () => {
    const r = iniciarEnvio(novoEnvio<Corpo>("chave-a"), (chave) => ({ requestKey: chave, valor: 1 }));
    expect(r?.corpo).toEqual({ requestKey: "chave-a", valor: 1 });
    expect(r?.estado.fase).toBe("enviando");
  });

  it("clique duplo: o segundo envio não sai enquanto o primeiro corre", () => {
    const r = iniciarEnvio(novoEnvio<Corpo>("chave-a"), (chave) => ({ requestKey: chave, valor: 1 }))!;
    expect(iniciarEnvio(r.estado, (chave) => ({ requestKey: chave, valor: 1 }))).toBeNull();
  });

  it("resposta perdida: repetir reenvia a MESMA chave com o MESMO corpo, nunca o proposto", () => {
    const primeiro = iniciarEnvio(novoEnvio<Corpo>("chave-a"), (chave) => ({ requestKey: chave, valor: 1 }))!;
    const incerto = concluirEnvio(primeiro.estado, { tipo: "rede" });
    expect(incerto.fase).toBe("incerto");
    expect(formularioTravado(incerto)).toBe(true);
    const repetido = iniciarEnvio(incerto, (chave) => ({ requestKey: `${chave}-nova`, valor: 999 }))!;
    expect(repetido.corpo).toEqual({ requestKey: "chave-a", valor: 1 });
  });

  it("CHAVE_EM_USO também é resultado desconhecido", () => {
    expect(resultadoDesconhecido({ tipo: "conflito", codigo: "CHAVE_EM_USO", mensagem: "", dados: {} })).toBe(true);
    expect(resultadoDesconhecido({ tipo: "conflito", codigo: "SALDO_INSUFICIENTE", mensagem: "", dados: {} })).toBe(false);
    const enviando: EstadoDoEnvio<Corpo> = { fase: "enviando", chave: "k", corpo: { requestKey: "k", valor: 1 } };
    expect(concluirEnvio(enviando, { tipo: "conflito", codigo: "CHAVE_EM_USO", mensagem: "", dados: {} }).fase).toBe("incerto");
  });

  it("recusa definitiva destrava o formulário e mantém a chave (nada foi gravado com ela)", () => {
    const enviando: EstadoDoEnvio<Corpo> = { fase: "enviando", chave: "k", corpo: { requestKey: "k", valor: 1 } };
    const recusado = concluirEnvio(enviando, { tipo: "conflito", codigo: "SALDO_INSUFICIENTE", mensagem: "Sem saldo", dados: {} });
    expect(recusado).toMatchObject({ fase: "recusado", chave: "k" });
    expect(formularioTravado(recusado)).toBe(false);
    expect(iniciarEnvio(recusado, (chave) => ({ requestKey: chave, valor: 2 }))?.corpo).toEqual({ requestKey: "k", valor: 2 });
  });

  it("corpo que não fecha não inicia envio", () => {
    expect(iniciarEnvio(novoEnvio<Corpo>("k"), () => null)).toBeNull();
  });

  it("uma chave nova só vem pedida explicitamente, depois do resultado confirmado", () => {
    expect(novoEnvio<Corpo>("outra")).toEqual({ fase: "pronto", chave: "outra" });
  });
});
