"use client";

// Token dos links de convite e de redefinição de senha. Ele chega no
// FRAGMENTO (`#t=…`), que o navegador não manda ao servidor; aqui ele é lido
// uma vez e apagado da barra de endereço (sem recarregar a página), para não
// ficar visível nem ir junto se a pessoa copiar o endereço. Fica só na
// memória da página e vai no corpo de um POST.
import { useEffect, useRef, useState } from "react";

const FORMATO = /^[0-9a-f]{64}$/;

export function lerTokenDoFragmento(hash: string): string | null {
  const valor = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  return valor && FORMATO.test(valor) ? valor : null;
}

/** `undefined` enquanto não leu; `null` se o link não tem token válido. */
export function useTokenDoLink(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  // O ref sobrevive à segunda execução do efeito no modo estrito: o
  // fragmento já foi apagado, e sem ele o token se perderia.
  const lido = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lido.current === undefined) {
      lido.current = lerTokenDoFragmento(window.location.hash);
      if (window.location.hash) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    // Lido uma vez, no cliente, depois da montagem: o fragmento não existe no servidor.
    setToken(lido.current);
  }, []);
  return token;
}
