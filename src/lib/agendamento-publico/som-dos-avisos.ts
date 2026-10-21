"use client";

// Som OPCIONAL dos avisos de novas solicitações. Desligado por padrão; a
// escolha fica só neste navegador (localStorage), porque é preferência de
// quem está diante da tela, não do estabelecimento.
//
// O som é um bipe curto gerado pelo próprio navegador (Web Audio): nenhum
// arquivo, nenhum serviço externo. Navegadores bloqueiam áudio até a pessoa
// interagir com a página; quando isso acontece, ou quando o áudio falha por
// qualquer motivo, o som simplesmente não toca — o aviso visual não depende
// dele.

const CHAVE = "agenda-cloud:som-dos-avisos";

let contexto: AudioContext | null = null;

export function lerPreferenciaDeSom(): boolean {
  try {
    return window.localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

export function salvarPreferenciaDeSom(ligado: boolean): void {
  try {
    if (ligado) window.localStorage.setItem(CHAVE, "1");
    else window.localStorage.removeItem(CHAVE);
  } catch {
    // Sem storage (aba privada, bloqueio): vale só até recarregar.
  }
}

/** Prepara o áudio. Chamar a partir de um clique ou toque: é o gesto que o
 * navegador exige para liberar o som. Nunca lança. */
export function prepararSom(): void {
  try {
    if (!contexto) {
      const Construtor = window.AudioContext;
      if (!Construtor) return;
      contexto = new Construtor();
    }
    if (contexto.state === "suspended") void contexto.resume().catch(() => undefined);
  } catch {
    contexto = null;
  }
}

/** Toca o bipe, se der. Nunca lança e nunca espera. */
export function tocarSom(): void {
  try {
    prepararSom();
    const ctx = contexto;
    if (!ctx || ctx.state !== "running") return;
    const oscilador = ctx.createOscillator();
    const volume = ctx.createGain();
    oscilador.type = "sine";
    oscilador.frequency.value = 880;
    volume.gain.setValueAtTime(0.0001, ctx.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    oscilador.connect(volume).connect(ctx.destination);
    oscilador.start();
    oscilador.stop(ctx.currentTime + 0.4);
  } catch {
    // Áudio bloqueado ou indisponível: segue só o aviso visual.
  }
}
