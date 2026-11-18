"use client";

// Estado da aparência no React. A fonte da verdade é o `data-tema` do
// `<html>` (gravado pelo SCRIPT_APARENCIA antes da pintura); este hook só o
// lê e o troca. Durante a hidratação o React usa o valor do servidor
// ("sistema") e logo depois o do navegador — sem erro de hidratação, porque
// `useSyncExternalStore` foi feito para isso.
import { useCallback, useSyncExternalStore } from "react";
import { APARENCIA_PADRAO, CHAVE_APARENCIA, lerPreferenciaSalva, type PreferenciaAparencia } from "./tema";

const EVENTO = "agenda-cloud:aparencia-alterada";

function assinar(aoMudar: () => void): () => void {
  // `storage`: a escolha feita em outra aba deste navegador vale aqui também.
  function aoMudarEmOutraAba(evento: StorageEvent) {
    if (evento.key !== CHAVE_APARENCIA) return;
    document.documentElement.setAttribute("data-tema", lerPreferenciaSalva(evento.newValue));
    aoMudar();
  }
  window.addEventListener(EVENTO, aoMudar);
  window.addEventListener("storage", aoMudarEmOutraAba);
  return () => {
    window.removeEventListener(EVENTO, aoMudar);
    window.removeEventListener("storage", aoMudarEmOutraAba);
  };
}

function lerDoDocumento(): PreferenciaAparencia {
  return lerPreferenciaSalva(document.documentElement.getAttribute("data-tema"));
}

/** Lê a escolha salva e a grava no `<html>`. Em desenvolvimento, o Strict
 * Mode do React remonta a árvore e limpa atributos que o script inline pôs
 * no `<html>`; quem monta uma página adaptável chama isto para recolocar. */
export function reaplicarAparenciaSalva(): void {
  let salvo: string | null = null;
  try {
    salvo = window.localStorage.getItem(CHAVE_APARENCIA);
  } catch {
    // Sem storage: fica o que já está no documento.
    return;
  }
  const valor = lerPreferenciaSalva(salvo);
  if (document.documentElement.getAttribute("data-tema") !== valor) {
    document.documentElement.setAttribute("data-tema", valor);
    window.dispatchEvent(new Event(EVENTO));
  }
}

export function useAparencia() {
  const preferencia = useSyncExternalStore(assinar, lerDoDocumento, () => APARENCIA_PADRAO);

  const escolher = useCallback((valor: PreferenciaAparencia) => {
    document.documentElement.setAttribute("data-tema", valor);
    try {
      window.localStorage.setItem(CHAVE_APARENCIA, valor);
    } catch {
      // Aba privada ou storage bloqueado: vale até recarregar.
    }
    window.dispatchEvent(new Event(EVENTO));
  }, []);

  return { preferencia, escolher };
}
