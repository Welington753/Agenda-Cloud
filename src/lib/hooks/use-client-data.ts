"use client";

import { useCallback, useEffect, useState } from "react";

/** Lê dados do repositório (localStorage) no cliente após a montagem, evitando
 * descompasso de hidratação entre servidor e navegador. `recarregar` força uma
 * nova leitura após uma mutação (criar/editar/cancelar). */
export function useClientData<T>(obter: () => T, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    setDados(obter());
    setCarregando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, versao]);

  return { dados, carregando, recarregar };
}
