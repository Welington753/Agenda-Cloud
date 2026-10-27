// O service worker real (public/sw.js) rodando num contexto isolado com um
// `self` falso: prova o que ele faz com um push e com o toque, sem
// navegador. Não prova exibição num aparelho (isso é o roteiro físico).
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Ouvinte = (evento: Record<string, unknown>) => void;

function carregarServiceWorker(janelas: { url: string; navigate?: (u: string) => Promise<unknown> }[] = []) {
  const ouvintes: Record<string, Ouvinte> = {};
  const notificacoes: { titulo: string; opcoes: Record<string, unknown> }[] = [];
  const abertas: string[] = [];
  const focadas: string[] = [];
  const self = {
    location: { origin: "https://agenda.example.test" },
    addEventListener: (tipo: string, ouvinte: Ouvinte) => {
      ouvintes[tipo] = ouvinte;
    },
    skipWaiting: () => undefined,
    registration: {
      showNotification: (titulo: string, opcoes: Record<string, unknown>) => {
        notificacoes.push({ titulo, opcoes });
        return Promise.resolve();
      },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () =>
        Promise.resolve(
          janelas.map((j) => ({
            url: j.url,
            focus: () => {
              focadas.push(j.url);
              return Promise.resolve();
            },
            ...(j.navigate ? { navigate: j.navigate } : {}),
          })),
        ),
      openWindow: (url: string) => {
        abertas.push(url);
        return Promise.resolve();
      },
    },
  };
  const codigo = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
  vm.runInNewContext(codigo, { self, URL, encodeURIComponent });

  async function disparar(tipo: string, evento: Record<string, unknown>) {
    const esperas: Promise<unknown>[] = [];
    ouvintes[tipo]({ ...evento, waitUntil: (p: Promise<unknown>) => esperas.push(p) });
    await Promise.all(esperas);
  }
  const push = (dados: unknown) =>
    disparar("push", {
      data: dados === undefined ? null : { json: (): unknown => (typeof dados === "string" ? (JSON.parse(dados) as unknown) : dados) },
    });
  const tocar = (data: unknown) => disparar("notificationclick", { notification: { data, close: () => undefined } });
  return { ouvintes, notificacoes, abertas, focadas, push, tocar };
}

const CONTEUDO = { v: 1, tipo: "nova-solicitacao", estabelecimento: "tenantabc123", solicitacao: "apptxyz789" };

describe("service worker (public/sw.js)", () => {
  it("não intercepta requisições nem usa cache: só push, toque, instalação e ativação", () => {
    const sw = carregarServiceWorker();
    expect(Object.keys(sw.ouvintes).sort()).toEqual(["activate", "install", "notificationclick", "push"]);
    const codigo = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
    expect(codigo).not.toMatch(/caches\.|addEventListener\(["']fetch/);
  });

  it("push mostra texto fixo e discreto, sem dado do cliente, com etiqueta por solicitação", async () => {
    const sw = carregarServiceWorker();
    await sw.push({ ...CONTEUDO, nome: "Joana Cliente", telefone: "11999990000" });
    expect(sw.notificacoes).toHaveLength(1);
    const [{ titulo, opcoes }] = sw.notificacoes;
    expect(titulo).toBe("Nova solicitação de agendamento");
    expect(opcoes.body).toBe("Toque para analisar.");
    expect(opcoes.tag).toBe("solicitacao-apptxyz789");
    expect(JSON.stringify({ titulo, opcoes })).not.toMatch(/Joana|11999990000/);
    expect(opcoes.data).toEqual({
      destino: "/conta/agendamentos/solicitacoes?estabelecimento=tenantabc123&solicitacao=apptxyz789",
    });
  });

  it("conteúdo inválido, ausente ou ids estranhos: aviso genérico que abre a lista", async () => {
    for (const dados of [undefined, "{não é json", { v: 2 }, { ...CONTEUDO, solicitacao: "../../x" }, { ...CONTEUDO, estabelecimento: "https://evil" }]) {
      const sw = carregarServiceWorker();
      await sw.push(dados);
      expect(sw.notificacoes).toHaveLength(1);
      expect((sw.notificacoes[0].opcoes.data as { destino: string }).destino).toBe("/conta/agendamentos/solicitacoes");
    }
  });

  it("toque abre a solicitação na própria origem; reaproveita janela aberta", async () => {
    const destino = "/conta/agendamentos/solicitacoes?estabelecimento=tenantabc123&solicitacao=apptxyz789";
    const semJanela = carregarServiceWorker();
    await semJanela.tocar({ destino });
    expect(semJanela.abertas).toEqual([`https://agenda.example.test${destino}`]);

    const navegadas: string[] = [];
    const comJanela = carregarServiceWorker([
      {
        url: "https://agenda.example.test/conta/clientes",
        navigate: (u) => {
          navegadas.push(u);
          return Promise.resolve(null);
        },
      },
    ]);
    await comJanela.tocar({ destino });
    expect(navegadas).toEqual([`https://agenda.example.test${destino}`]);
    expect(comJanela.abertas).toEqual([]);
  });

  it("notificação entregue antes da mudança abre o endereço antigo, que o site encaminha", async () => {
    const destino = "/conta/solicitacoes?estabelecimento=tenantabc123&solicitacao=apptxyz789";
    const sw = carregarServiceWorker();
    await sw.tocar({ destino });
    expect(sw.abertas).toEqual([`https://agenda.example.test${destino}`]);
  });

  it("destino adulterado na notificação nunca sai da origem nem da lista", async () => {
    for (const destino of [
      "https://evil.example/x",
      "//evil.example/x",
      "/login",
      "/conta/solicitacoes-falsa",
      "/conta/agendamentos/solicitacoesx",
      42,
    ]) {
      const sw = carregarServiceWorker();
      await sw.tocar({ destino });
      expect(sw.abertas).toEqual(["https://agenda.example.test/conta/agendamentos/solicitacoes"]);
    }
  });
});
