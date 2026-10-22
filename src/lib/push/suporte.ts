// Regras puras das notificações deste dispositivo (testáveis sem navegador).
//
// Nada aqui promete suporte: o estado vem das capacidades REAIS do navegador
// (service worker, PushManager, Notification). No iPhone/iPad, o Safari só
// oferece push para o site adicionado à Tela de Início (iOS 16.4+): fora
// dele, o PushManager nem existe — então mostramos como instalar, e só
// depois de instalado o botão aparece (se o iOS de fato oferecer).

export type SuporteDoDispositivo = "suportado" | "nao_suportado" | "instalar_no_iphone";

export interface Ambiente {
  temServiceWorker: boolean;
  temPushManager: boolean;
  temNotification: boolean;
  ehIos: boolean;
  /** Aberto como aplicativo instalado (tela cheia, pela Tela de Início). */
  instalado: boolean;
}

export function avaliarSuporte(ambiente: Ambiente): SuporteDoDispositivo {
  if (ambiente.temServiceWorker && ambiente.temPushManager && ambiente.temNotification) return "suportado";
  if (ambiente.ehIos && !ambiente.instalado) return "instalar_no_iphone";
  return "nao_suportado";
}

/** iPhone/iPad, inclusive o iPad que se apresenta como Mac. */
export function ehIos(userAgent: string, plataforma: string, toques: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return plataforma === "MacIntel" && toques > 1;
}

/** Chave pública VAPID (base64url) no formato que o PushManager espera. */
export function bytesDaChave(base64url: string): Uint8Array<ArrayBuffer> {
  const preenchida = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const binario = atob(preenchida);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** A inscrição existente foi criada com ESTA chave pública? (Trocar o par
 * VAPID no servidor exige inscrever de novo.) */
export function mesmaChave(atual: ArrayBuffer | null | undefined, esperada: Uint8Array): boolean {
  if (!atual) return false;
  const a = new Uint8Array(atual);
  return a.length === esperada.length && a.every((byte, i) => byte === esperada[i]);
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,30}$/;

export interface DestinoDaNotificacao {
  tenantId: string;
  solicitacaoId: string;
}

/** Destino aberto pelo toque na notificação (`?estabelecimento=&solicitacao=`).
 * Só ids no formato esperado; qualquer outra coisa é ignorada. É só um
 * DESTINO: a página ainda confere sessão, vínculo e permissão. */
export function lerDestinoDaNotificacao(busca: string): DestinoDaNotificacao | null {
  const parametros = new URLSearchParams(busca);
  const tenantId = parametros.get("estabelecimento");
  const solicitacaoId = parametros.get("solicitacao");
  if (!tenantId || !solicitacaoId || !ID_VALIDO.test(tenantId) || !ID_VALIDO.test(solicitacaoId)) return null;
  return { tenantId, solicitacaoId };
}
