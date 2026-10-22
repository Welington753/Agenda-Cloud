"use client";

// Efeitos do navegador para o Web Push: registrar o service worker
// (/sw.js, sem cache nenhum), inscrever e cancelar a inscrição DESTE
// aparelho. A permissão de notificação só é pedida pelo botão (gesto da
// pessoa), nunca ao abrir a página.
import { desativarInscricao } from "@/lib/api/push-api";
import { bytesDaChave, ehIos, mesmaChave, type Ambiente } from "./suporte";

export function lerAmbiente(): Ambiente {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    temServiceWorker: "serviceWorker" in navigator,
    temPushManager: "PushManager" in window,
    temNotification: "Notification" in window,
    ehIos: ehIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0),
    instalado: window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true,
  };
}

async function registro(): Promise<ServiceWorkerRegistration> {
  const existente = await navigator.serviceWorker.getRegistration("/");
  if (existente) return existente;
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

/** Inscrição atual deste navegador, sem registrar nada. */
export async function inscricaoAtual(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Inscreve (ou reaproveita a inscrição feita com a mesma chave). */
export async function inscrever(chavePublica: string): Promise<PushSubscription> {
  const reg = await registro();
  const chave = bytesDaChave(chavePublica);
  const atual = await reg.pushManager.getSubscription();
  if (atual && mesmaChave(atual.options.applicationServerKey, chave)) return atual;
  if (atual) await atual.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
}

/**
 * Ao SAIR da conta: avisa o servidor (melhor esforço) e cancela a inscrição
 * deste navegador, para o próximo usuário do aparelho não herdar os avisos.
 * Mesmo se tudo falhar, o servidor já não envia: a inscrição está presa à
 * sessão encerrada. Nunca demora mais que `limiteMs`.
 */
export async function encerrarNoDispositivo(tenantId: string | null, limiteMs = 1500): Promise<void> {
  const trabalho = (async () => {
    try {
      const atual = await inscricaoAtual();
      if (!atual) return;
      if (tenantId) await desativarInscricao(tenantId, atual.endpoint);
      await atual.unsubscribe();
    } catch {
      // Melhor esforço.
    }
  })();
  await Promise.race([trabalho, new Promise((pronto) => setTimeout(pronto, limiteMs))]);
}
