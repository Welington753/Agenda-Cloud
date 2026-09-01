import { describe, expect, it } from "vitest";
import { obterTerminologia } from "./terminologia";

describe("obterTerminologia", () => {
  it("aplica a terminologia de barbearia", () => {
    const t = obterTerminologia("barbearia");
    expect(t.profissional.singular).toBe("Barbeiro");
    expect(t.consumidor.singular).toBe("Cliente");
    expect(t.servico.singular).toBe("Serviço");
    expect(t.agendamento.singular).toBe("Horário");
  });

  it("aplica a terminologia de clínica odontológica", () => {
    const t = obterTerminologia("clinica_odontologica");
    expect(t.profissional.singular).toBe("Dentista");
    expect(t.consumidor.singular).toBe("Paciente");
    expect(t.servico.singular).toBe("Procedimento");
    expect(t.agendamento.singular).toBe("Consulta");
  });

  it("cai para a terminologia genérica quando a categoria não é reconhecida ou está ausente", () => {
    expect(obterTerminologia(undefined).profissional.singular).toBe("Profissional");
    // @ts-expect-error — testa deliberadamente um valor fora do union para provar o fallback seguro.
    expect(obterTerminologia("categoria-inexistente").consumidor.singular).toBe("Cliente");
  });
});
