import { describe, expect, it } from "vitest";
import {
  dataBr,
  diasOferecidos,
  estadoDoRecibo,
  gerarChaveDeEnvio,
  linkPublico,
  mensagemFalhaPublica,
  mensagemSemHorario,
  precoTexto,
  somarDias,
} from "./agendamento-publico";

describe("datas no fuso do estabelecimento", () => {
  it("hoje é o dia LOCAL do estabelecimento, não o do navegador", () => {
    // 02:30Z de 08/03 ainda é 07/03 em Manaus (UTC-4) e já é 08/03 em UTC.
    const agora = new Date("2027-03-08T02:30:00.000Z");
    expect(diasOferecidos("America/Manaus", agora, 2)).toEqual([
      { date: "2027-03-07", rotulo: "dom 07/03" },
      { date: "2027-03-08", rotulo: "seg 08/03" },
    ]);
    expect(diasOferecidos("UTC", agora, 1)[0].date).toBe("2027-03-08");
  });

  it("soma dias pelo calendário, inclusive virada de mês e ano", () => {
    expect(somarDias("2027-02-27", 2)).toBe("2027-03-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(dataBr("2027-03-07")).toBe("07/03/2027");
  });

  it("fuso inválido não inventa dias", () => {
    expect(diasOferecidos("Fuso/Inexistente", new Date())).toEqual([]);
  });
});

describe("textos do pedido", () => {
  it("pendente nunca aparece como confirmado", () => {
    expect(estadoDoRecibo("PENDING")).toBe("Aguardando confirmação do estabelecimento");
    expect(estadoDoRecibo("PENDING")).not.toMatch(/^Confirmado/);
    expect(estadoDoRecibo("CONFIRMED")).toMatch(/Confirmado/);
  });

  it("resultado incerto não afirma que nada foi criado", () => {
    const texto = mensagemFalhaPublica({ tipo: "incerto" });
    expect(texto).toMatch(/pode ter sido registrado/);
    expect(texto).not.toMatch(/não foi (criado|registrado|enviado)/);
  });

  it("mensagens do servidor têm prioridade; sem elas, texto claro", () => {
    expect(mensagemFalhaPublica({ tipo: "conflito", mensagem: "X" })).toBe("X");
    expect(mensagemFalhaPublica({ tipo: "conflito", mensagem: null })).toMatch(/ocupado/);
    expect(mensagemFalhaPublica({ tipo: "falha_comunicacao" })).toMatch(/conexão/);
    expect(mensagemFalhaPublica({ tipo: "indisponivel" })).toMatch(/problema/);
    expect(mensagemFalhaPublica({ tipo: "indisponivel" })).not.toMatch(/conexão|acordar|sem uso/);
    expect(mensagemSemHorario("sem_jornada")).toMatch(/Sem atendimento/);
    expect(mensagemSemHorario("sem_horario_livre")).toMatch(/ocupados/);
  });

  it("preço: oculto, sob consulta ou em reais", () => {
    expect(precoTexto(5000, false)).toBeNull();
    expect(precoTexto(null, true)).toBe("Sob consulta");
    expect(precoTexto(12000, true)).toMatch(/120,00/);
  });
});

describe("chave e link", () => {
  it("chave aceita pelo contrato do backend e diferente a cada pedido", () => {
    const a = gerarChaveDeEnvio();
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(gerarChaveDeEnvio()).not.toBe(a);
  });

  it("link público do estabelecimento", () => {
    expect(linkPublico("https://app.exemplo.com/", "clinica-ana")).toBe("https://app.exemplo.com/agendar/clinica-ana");
  });
});

describe("solicitações", () => {
  it("data local pelo fuso devolvido pelo servidor", async () => {
    const { dataLocalDoInstante, textoPendentes } = await import("./solicitacoes");
    // 02:00Z de 08/03 = 23:00 de 07/03 em São Paulo.
    expect(dataLocalDoInstante("2027-03-08T02:00:00.000Z", "America/Sao_Paulo")).toBe("2027-03-07");
    expect(dataLocalDoInstante("lixo", "America/Sao_Paulo")).toBeNull();
    expect(textoPendentes(0)).toMatch(/Nenhuma/);
    expect(textoPendentes(1)).toBe("1 solicitação aguardando sua confirmação.");
    expect(textoPendentes(3)).toBe("3 solicitações aguardando sua confirmação.");
  });
});
