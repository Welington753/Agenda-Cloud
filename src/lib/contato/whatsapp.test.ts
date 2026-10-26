import { describe, expect, it } from "vitest";
import {
  dataNoFuso,
  linkWhatsapp,
  mensagemCombinarOutroHorario,
  telefoneParaWhatsapp,
} from "./whatsapp";

describe("telefoneParaWhatsapp", () => {
  it("formata como o normalizePhone do backend: +55 quando falta o código do país", () => {
    expect(telefoneParaWhatsapp("(11) 90000-0000")).toBe("5511900000000");
    expect(telefoneParaWhatsapp("1133334444")).toBe("551133334444");
    expect(telefoneParaWhatsapp("+55 11 90000-0000")).toBe("5511900000000");
    expect(telefoneParaWhatsapp("5511900000000")).toBe("5511900000000");
  });

  it("sem telefone ou fora de 10 a 13 dígitos: sem link", () => {
    expect(telefoneParaWhatsapp(null)).toBeNull();
    expect(telefoneParaWhatsapp(undefined)).toBeNull();
    expect(telefoneParaWhatsapp("")).toBeNull();
    expect(telefoneParaWhatsapp("   ")).toBeNull();
    expect(telefoneParaWhatsapp("123456789")).toBeNull();
    expect(telefoneParaWhatsapp("12345678901234")).toBeNull();
    expect(telefoneParaWhatsapp("sem telefone")).toBeNull();
  });
});

describe("linkWhatsapp", () => {
  it("usa o link oficial wa.me", () => {
    expect(linkWhatsapp("(11) 90000-0000")).toBe("https://wa.me/5511900000000");
  });

  it("codifica o texto: acentos, &, ?, #, + e quebra de linha", () => {
    const texto = "Olá, João & Cia? #1 + 50%\nAté já";
    const link = linkWhatsapp("11900000000", texto)!;
    const url = new URL(link);
    expect(url.origin + url.pathname).toBe("https://wa.me/5511900000000");
    expect(url.searchParams.get("text")).toBe(texto);
    expect(link).not.toContain(" ");
    expect(link).not.toContain("&C");
  });

  it("telefone inválido não gera link, mesmo com texto", () => {
    expect(linkWhatsapp("123", "Olá")).toBeNull();
  });
});

describe("dataNoFuso", () => {
  it("usa o fuso do estabelecimento, não o do navegador", () => {
    // 02:30Z do dia 21 ainda é dia 20 em São Paulo (UTC-3) e já é 21 em Lisboa.
    expect(dataNoFuso("2026-10-21T02:30:00.000Z", "America/Sao_Paulo")).toBe("20/10/2026");
    expect(dataNoFuso("2026-10-21T02:30:00.000Z", "Europe/Lisbon")).toBe("21/10/2026");
  });

  it("fuso inválido devolve null", () => {
    expect(dataNoFuso("2026-10-21T02:30:00.000Z", "Fuso/Inexistente")).toBeNull();
  });
});

describe("mensagemCombinarOutroHorario", () => {
  const base = {
    nomeCliente: "Maria  da Silva",
    estabelecimento: "Estúdio Ana & Bia",
    startAt: "2026-10-21T02:30:00.000Z",
    horaLocal: "23:30",
    timezone: "America/Sao_Paulo",
  };

  it("monta a mensagem neutra com primeiro nome, estabelecimento, data e hora locais", () => {
    expect(mensagemCombinarOutroHorario(base)).toBe(
      "Olá, Maria! Aqui é do Estúdio Ana & Bia. Precisamos combinar outro horário para seu agendamento de " +
        "20/10/2026 às 23:30. Qual dia ou período fica melhor para você? " +
        "Vamos conferir a disponibilidade antes de confirmar a alteração.",
    );
  });

  it("nunca leva dados do serviço", () => {
    const texto = mensagemCombinarOutroHorario(base)!;
    expect(texto).not.toMatch(/servi|consulta|procedimento/i);
  });

  it("pede a conversa sem afirmar que a reserva mudou, foi cancelada ou confirmada", () => {
    const texto = mensagemCombinarOutroHorario(base)!;
    expect(texto).not.toMatch(/remarcad|cancelad|confirmad|foi alterad|novo horário é/i);
    expect(texto).toContain("antes de confirmar a alteração");
  });

  it("nome vazio vira só 'Olá!'; sem estabelecimento, a apresentação sai", () => {
    expect(mensagemCombinarOutroHorario({ ...base, nomeCliente: " " })).toMatch(/^Olá! Aqui é do/);
    expect(mensagemCombinarOutroHorario({ ...base, estabelecimento: "  " })).toMatch(
      /^Olá, Maria! Precisamos combinar/,
    );
    expect(mensagemCombinarOutroHorario({ ...base, estabelecimento: " Ana \n Bia " })).toContain(
      "Aqui é do Ana Bia.",
    );
  });

  it("fuso ou hora inválidos não geram mensagem", () => {
    expect(mensagemCombinarOutroHorario({ ...base, timezone: "x/y" })).toBeNull();
    expect(mensagemCombinarOutroHorario({ ...base, horaLocal: "" })).toBeNull();
    expect(mensagemCombinarOutroHorario({ ...base, horaLocal: "23:30:00" })).toBeNull();
  });

  it("link completo decodifica de volta para a mesma mensagem", () => {
    const texto = mensagemCombinarOutroHorario(base)!;
    const link = linkWhatsapp("(11) 90000-0000", texto)!;
    expect(new URL(link).searchParams.get("text")).toBe(texto);
  });
});
