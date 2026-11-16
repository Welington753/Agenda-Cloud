import { describe, expect, it } from "vitest";
import {
  COMO_FUNCIONA,
  CONTATO,
  EMAIL_CONTATO,
  FUNCIONALIDADES_DESTAQUE,
  FUNCIONALIDADES_DISPONIVEIS,
  HREF_COMO_OBTER_ACESSO,
  HREF_DEMONSTRACAO,
  HREF_EMAIL_CONTATO,
  HREF_ENTRAR,
  NAV_SITE,
  NOTA_DOS_PLANOS,
  PARA_QUEM,
  PERGUNTAS_FREQUENTES,
  PLANOS_COMERCIAIS,
  ROTULOS_DE_PRECO,
  SEGMENTOS,
  TOPO,
  precosExibidos,
} from "./conteudo-comercial";
import { AGENDAMENTOS_DA_PREVIA, ROTULO_DA_PREVIA, agendamentosDaPrevia } from "./previa-da-agenda";

/** Todo texto que a página inicial mostra, menos as respostas do FAQ (que
 * podem negar um recurso: "Ainda não."). */
const textosAfirmativos = () =>
  [
    ...Object.values(TOPO),
    ...Object.values(PARA_QUEM),
    ...Object.values(CONTATO),
    NOTA_DOS_PLANOS,
    ...COMO_FUNCIONA.flatMap((e) => [e.titulo, e.descricao]),
    ...FUNCIONALIDADES_DESTAQUE.flatMap((f) => [f.rotulo, f.descricao]),
    ...FUNCIONALIDADES_DISPONIVEIS.flatMap((f) => [f.rotulo, f.descricao]),
    ...PLANOS_COMERCIAIS.flatMap((p) => [p.nome, p.descricaoCurta, ...p.destaques]),
    ...PERGUNTAS_FREQUENTES.map((p) => p.pergunta),
  ]
    .join(" ")
    .toLowerCase();

describe("SEGMENTOS", () => {
  it("cobre uma diversidade de públicos, não só barbearia", () => {
    expect(SEGMENTOS.length).toBeGreaterThanOrEqual(8);
    const rotulos = SEGMENTOS.map((s) => s.rotulo.toLowerCase()).join(" | ");
    for (const termo of ["clínica", "pet shop", "terapeuta", "pilates", "consultor", "tatuagem"]) {
      expect(rotulos).toContain(termo);
    }
  });

  it("tem ids únicos", () => {
    const ids = SEGMENTOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("nenhum outro texto menciona 'barbearia' fora da lista de segmentos", () => {
    const textos = [textosAfirmativos(), ...PERGUNTAS_FREQUENTES.map((p) => p.resposta.toLowerCase())].join(" ");
    expect(textos).not.toContain("barbearia");
    expect(textos).not.toContain("barbeiro");
  });
});

describe("só o que o produto publicado sustenta", () => {
  it("não anuncia WhatsApp, SMS, lembrete, push, cobrança, IA nem recurso ainda não publicado", () => {
    const texto = textosAfirmativos().replace("o sistema envia whatsapp, sms ou lembrete automático?", "");
    for (const termo of [
      "whatsapp",
      "sms",
      "lembrete",
      "push",
      "inteligência artificial",
      "em massa",
      "unidades",
      "personaliza",
      "domínio próprio",
      "integra",
      "relatório",
      "duas etapas",
    ]) {
      expect(texto, termo).not.toContain(termo);
    }
    // "cobrança" só aparece negada ("O sistema não faz cobrança").
    expect(texto.match(/cobrança/g)?.length ?? 0).toBe(texto.match(/não faz cobrança/g)?.length ?? 0);
  });

  it("não fala como protótipo nem promete cadastro aberto ou teste grátis", () => {
    // "sem criar conta" fala do cliente que agenda; o que não pode é convidar
    // o negócio a criar a própria conta.
    const texto = [textosAfirmativos(), ...PERGUNTAS_FREQUENTES.map((p) => p.resposta.toLowerCase())]
      .join(" ")
      .replace(/(sem|precisa) criar conta/g, "");
    for (const termo of ["protótipo", "piloto", "teste grátis", "crie sua conta", "criar conta", "cartão de crédito", "em breve"]) {
      expect(texto, termo).not.toContain(termo);
    }
  });

  it("sem depoimento nem números de clientes", () => {
    expect(textosAfirmativos()).not.toMatch(/\bclientes satisfeitos\b|avalia|depoimento/);
  });

  it("preço só na seção de planos: nenhum outro texto traz valor em reais", () => {
    expect(textosAfirmativos()).not.toMatch(/r\$/);
  });

  it("não anuncia desconto, percentual, gratuidade, checkout nem pagamento automático", () => {
    const texto = [textosAfirmativos(), ...Object.values(ROTULOS_DE_PRECO)].join(" ").toLowerCase();
    expect(texto).not.toMatch(/%|desconto|econom|grátis|gratuit|assine|checkout|pix|boleto|cartão|automátic[ao] de pagamento/);
  });

  it("o pedido do cliente entra na agenda como aguardando confirmação, nunca como confirmado", () => {
    const passos = COMO_FUNCIONA.map((e) => e.descricao).join(" ");
    expect(passos).toContain("Aguardando confirmação");
    expect(passos).toMatch(/confirmam ou recusam/);
  });
});

describe("planos comerciais", () => {
  it("usa os códigos internos do domínio (essencial/equipe/pro) com nomes comerciais Básico/Pro/Max", () => {
    expect(PLANOS_COMERCIAIS.map((p) => p.codigo)).toEqual(["essencial", "equipe", "pro"]);
    expect(PLANOS_COMERCIAIS.map((p) => p.nome)).toEqual(["Básico", "Pro", "Max"]);
  });

  it("limites de profissionais do catálogo real (2, 5 e 20)", () => {
    expect(PLANOS_COMERCIAIS.map((p) => p.destaques.find((d) => /profissionais/.test(d)))).toEqual([
      "Até 2 profissionais",
      "Até 5 profissionais",
      "Até 20 profissionais",
    ]);
  });

  it("preços aprovados, em centavos inteiros: mensal e total do trimestre", () => {
    expect(
      PLANOS_COMERCIAIS.map((p) => [p.nome, p.precoMensalCentavos, p.precoTrimestralCentavos]),
    ).toEqual([
      ["Básico", 3990, 10790],
      ["Pro", 6990, 18890],
      ["Max", 11990, 32390],
    ]);
    for (const plano of PLANOS_COMERCIAIS) {
      expect(Number.isInteger(plano.precoMensalCentavos)).toBe(true);
      expect(Number.isInteger(plano.precoTrimestralCentavos)).toBe(true);
    }
  });

  it("mostra os preços em reais, como aprovados", () => {
    // O formatador separa "R$" do número com espaço não separável.
    const semEspacoEspecial = (texto: string) => texto.replace(/ /g, " ");
    expect(
      PLANOS_COMERCIAIS.map((p) => {
        const precos = precosExibidos(p);
        return [semEspacoEspecial(precos.mensal), semEspacoEspecial(precos.trimestral)];
      }),
    ).toEqual([
      ["R$ 39,90", "R$ 107,90"],
      ["R$ 69,90", "R$ 188,90"],
      ["R$ 119,90", "R$ 323,90"],
    ]);
  });

  it("o trimestral é apresentado como total dos três meses, nunca como valor por mês", () => {
    expect(ROTULOS_DE_PRECO.porMes).toBe("por mês");
    expect(ROTULOS_DE_PRECO.porTrimestre).toBe("por trimestre");
    expect(ROTULOS_DE_PRECO.totalDoTrimestre).toMatch(/Total dos três meses/);
    expect(NOTA_DOS_PLANOS).toMatch(/total dos três meses/);
    // Um total de trimestre maior que o mensal: se alguém trocar os campos
    // ou digitar o trimestral como valor mensal, o teste reprova.
    for (const plano of PLANOS_COMERCIAIS) {
      expect(plano.precoTrimestralCentavos).toBeGreaterThan(plano.precoMensalCentavos);
    }
  });

  it("não sobrou o texto de quando a página não publicava preço", () => {
    expect(NOTA_DOS_PLANOS).not.toMatch(/Sem preço publicado/);
  });

  it("nenhum plano promete multiunidade, que não existe no produto", () => {
    for (const plano of PLANOS_COMERCIAIS) {
      expect([plano.descricaoCurta, ...plano.destaques].join(" ")).not.toMatch(/unidade/i);
    }
  });

  it("comissões no Pro (e no Max, que inclui tudo do Pro), nunca no Básico", () => {
    const texto = (codigo: string) => {
      const plano = PLANOS_COMERCIAIS.find((p) => p.codigo === codigo)!;
      return [plano.descricaoCurta, ...plano.destaques].join(" ");
    };
    expect(texto("essencial")).not.toMatch(/comiss/i);
    expect(texto("equipe")).toMatch(/comiss/i);
    expect(texto("pro")).toMatch(/Tudo do Pro/);
    const comissoes = FUNCIONALIDADES_DISPONIVEIS.find((f) => f.id === "comissoes");
    expect(comissoes?.descricao).toMatch(/Pro e Max/);
  });
});

describe("navegação e destinos", () => {
  it("inclui Produto, Funcionalidades, Para quem e Planos", () => {
    expect(NAV_SITE.map((i) => i.rotulo)).toEqual(["Produto", "Funcionalidades", "Para quem", "Planos"]);
  });

  it("todo item de navegação usa âncora interna", () => {
    expect(NAV_SITE.every((i) => i.href.startsWith("#"))).toBe(true);
  });

  it("Entrar vai ao login real; Como obter acesso, à seção de contato; a demonstração é local", () => {
    expect(HREF_ENTRAR).toBe("/login");
    expect(HREF_COMO_OBTER_ACESSO).toBe("#contato");
    expect(HREF_DEMONSTRACAO).toBe("/onboarding");
  });

  it("e-mail de contato público e link mailto para ele", () => {
    expect(EMAIL_CONTATO).toBe("timvix.agenda@gmail.com");
    expect(HREF_EMAIL_CONTATO.startsWith(`mailto:${EMAIL_CONTATO}?subject=`)).toBe(true);
    expect(PERGUNTAS_FREQUENTES.find((p) => p.id === "como-obter-acesso")?.resposta).toContain(EMAIL_CONTATO);
  });
});

describe("prévia da agenda", () => {
  it("é identificada como demonstração com dados fictícios", () => {
    expect(ROTULO_DA_PREVIA).toMatch(/Demonstração/);
    expect(ROTULO_DA_PREVIA).toMatch(/dados fictícios/);
  });

  it("só usa estados reais da agenda e nenhum dado de contato", () => {
    for (const a of AGENDAMENTOS_DA_PREVIA) {
      expect(["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELED", "NO_SHOW"]).toContain(a.status);
      expect(a.consumer.whatsapp).toBeNull();
    }
  });

  it("em ordem de horário, como a lista da agenda real", () => {
    const horarios = agendamentosDaPrevia().map((a) => a.localStart);
    expect(horarios).toEqual(["09:00", "09:30", "10:30", "11:00", "14:00"]);
  });
});
