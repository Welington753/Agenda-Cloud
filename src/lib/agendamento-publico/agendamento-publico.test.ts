import { describe, expect, it } from "vitest";
import {
  agruparPorPeriodo,
  dataBr,
  dataPorExtenso,
  diasOferecidos,
  estadoDoRecibo,
  filtrarServicos,
  gerarChaveDeEnvio,
  iniciaisDoEstabelecimento,
  linkPublico,
  mensagemFalhaPublica,
  mensagemSemHorario,
  nomeDoFuso,
  nomePlausivel,
  precoPublico,
  precoTexto,
  somarDias,
  tituloDoRecibo,
  whatsappPlausivel,
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

describe("apresentação da página pública", () => {
  it("iniciais do estabelecimento sem logo", () => {
    expect(iniciaisDoEstabelecimento("Clínica da Ana")).toBe("CA");
    expect(iniciaisDoEstabelecimento("estúdio")).toBe("ES");
    expect(iniciaisDoEstabelecimento("  Pet & Cia  ")).toBe("PC");
    expect(iniciaisDoEstabelecimento("")).toBe("?");
  });

  it("busca local por nome, sem acento nem maiúsculas", () => {
    const lista = [{ name: "Sessão de Fisioterapia" }, { name: "Massagem" }, { name: "Avaliação" }];
    expect(filtrarServicos(lista, "sessao").map((s) => s.name)).toEqual(["Sessão de Fisioterapia"]);
    expect(filtrarServicos(lista, "  MASS ").map((s) => s.name)).toEqual(["Massagem"]);
    expect(filtrarServicos(lista, "")).toHaveLength(3);
    expect(filtrarServicos(lista, "xyz")).toEqual([]);
  });

  it("preço ausente ou oculto aparece como Sob consulta", () => {
    expect(precoPublico(null, true)).toBe("Sob consulta");
    expect(precoPublico(null, false)).toBe("Sob consulta");
    expect(precoPublico(4500, true)).toMatch(/45,00/);
  });

  it("horários agrupados por período local, na ordem do servidor", () => {
    const grupos = agruparPorPeriodo([{ localStart: "08:00" }, { localStart: "11:30" }, { localStart: "12:00" }, { localStart: "18:00" }]);
    expect(grupos.map((g) => [g.periodo, g.slots.length])).toEqual([
      ["Manhã", 2],
      ["Tarde", 1],
      ["Noite", 1],
    ]);
  });

  it("data por extenso e nome do fuso do estabelecimento", () => {
    expect(dataPorExtenso("2027-03-07")).toBe("domingo, 07/03/2027");
    expect(nomeDoFuso("America/Sao_Paulo", new Date("2027-03-07T12:00:00Z"))).toMatch(/\(America\/Sao_Paulo\)$/);
    expect(nomeDoFuso("Fuso/Inexistente", new Date())).toBe("Fuso/Inexistente");
  });

  it("validação local mínima dos dados", () => {
    expect(nomePlausivel(" J ")).toBe(false);
    expect(nomePlausivel("Jo")).toBe(true);
    expect(whatsappPlausivel("(11) 98765-4321")).toBe(true);
    expect(whatsappPlausivel("+55 11 98765-4321")).toBe(true);
    expect(whatsappPlausivel("98765-4321")).toBe(false);
  });

  it("título do recibo: pendente nunca parece confirmado", () => {
    expect(tituloDoRecibo("PENDING")).toBe("Solicitação enviada — aguardando confirmação");
    expect(tituloDoRecibo("PENDING")).not.toMatch(/confirmad[oa]\b/i);
    expect(tituloDoRecibo("CONFIRMED")).toMatch(/confirmado/);
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
