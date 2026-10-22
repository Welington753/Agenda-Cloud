import { describe, expect, it } from "vitest";
import { avaliarSuporte, bytesDaChave, ehIos, lerDestinoDaNotificacao, mesmaChave, resumoDoPush, type Ambiente } from "./suporte";

const COMPLETO: Ambiente = { temServiceWorker: true, temPushManager: true, temNotification: true, ehIos: false, instalado: false };
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

describe("suporte do dispositivo", () => {
  it("só promete push com service worker, PushManager e Notification de verdade", () => {
    expect(avaliarSuporte(COMPLETO)).toBe("suportado");
    expect(avaliarSuporte({ ...COMPLETO, temPushManager: false })).toBe("nao_suportado");
    expect(avaliarSuporte({ ...COMPLETO, temServiceWorker: false })).toBe("nao_suportado");
    expect(avaliarSuporte({ ...COMPLETO, temNotification: false })).toBe("nao_suportado");
  });

  it("iPhone no Safari (sem instalar): explica a Tela de Início; instalado sem push: não suportado", () => {
    const iphone = { ...COMPLETO, temPushManager: false, temNotification: false, ehIos: true };
    expect(avaliarSuporte(iphone)).toBe("instalar_no_iphone");
    expect(avaliarSuporte({ ...iphone, instalado: true })).toBe("nao_suportado");
    expect(avaliarSuporte({ ...COMPLETO, ehIos: true, instalado: true })).toBe("suportado");
  });

  it("reconhece iPhone e iPad (inclusive o que se apresenta como Mac)", () => {
    expect(ehIos(SAFARI_IPHONE, "iPhone", 5)).toBe(true);
    expect(ehIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
    expect(ehIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(ehIos("Mozilla/5.0 (Linux; Android 14; Pixel 8)", "Linux armv8l", 5)).toBe(false);
  });

  it("chave VAPID base64url vira bytes e é comparada com a da inscrição", () => {
    const bytes = bytesDaChave("BAEC_-8");
    expect([...bytes]).toEqual([4, 1, 2, 255, 239]);
    expect(mesmaChave(bytes.buffer, bytes)).toBe(true);
    expect(mesmaChave(new Uint8Array([4, 1]).buffer, bytes)).toBe(false);
    expect(mesmaChave(null, bytes)).toBe(false);
  });
});

describe("destino da notificação", () => {
  it("aceita só ids no formato esperado", () => {
    expect(lerDestinoDaNotificacao("?estabelecimento=t1abc&solicitacao=a2xyz")).toEqual({
      tenantId: "t1abc",
      solicitacaoId: "a2xyz",
    });
    for (const busca of ["", "?estabelecimento=t1", "?estabelecimento=../x&solicitacao=a", "?estabelecimento=t1&solicitacao=https://evil"]) {
      expect(lerDestinoDaNotificacao(busca)).toBeNull();
    }
  });
});

describe("resumo do push no menu da conta", () => {
  it("quatro situações para quem lê, sem transformar dúvida em desativado", () => {
    expect(resumoDoPush("ativado").situacao).toBe("ativado");
    expect(resumoDoPush("desativado").situacao).toBe("desativado");
    expect(resumoDoPush("bloqueado").situacao).toBe("bloqueado");
    for (const t of ["nao_suportado", "instalar_no_iphone", "servidor_sem_push"] as const) {
      expect(resumoDoPush(t).situacao).toBe("indisponivel");
    }
    expect(resumoDoPush("instalar_no_iphone").texto).toMatch(/Tela de Início/);
    expect(resumoDoPush("verificando").situacao).toBe("verificando");
    expect(resumoDoPush("falha").situacao).toBe("falha");
  });
});
