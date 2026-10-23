"use client";

import { useCallback, useEffect, useState } from "react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { apiRequest } from "@/lib/api/http-client";

export type LeituraPlataforma<T> =
  | { status: "carregando" }
  | { status: "pronto"; dados: T }
  | {
      status: "erro";
      motivo: "sessao" | "permissao" | "ausente" | "rede" | "servidor";
    };

/** A chave inclui a identidade e a consulta. Nem o resultado anterior nem
 * uma resposta atrasada podem aparecer para outra conta/filtro/detalhe. */
export function useLeituraPlataforma<T>(
  path: string | null,
  validar: (value: unknown) => value is T,
) {
  const { estado: autenticacao } = useRealAuth();
  const userId =
    autenticacao.status === "autenticado" ? autenticacao.sessao.user.id : null;
  const [tentativa, setTentativa] = useState(0);
  const base = JSON.stringify([userId, path]);
  const chave = JSON.stringify([userId, path, tentativa]);
  const [resposta, setResposta] = useState<{
    chave: string;
    base: string;
    estado: LeituraPlataforma<T>;
  } | null>(null);
  useEffect(() => {
    if (!path || !userId) return;
    const controller = new AbortController();
    let encerrado = false;
    void apiRequest<unknown>(path, { signal: controller.signal }).then(
      (result) => {
        if (encerrado) return;
        let estado: LeituraPlataforma<T>;
        if (result.kind === "success")
          estado = validar(result.data)
            ? { status: "pronto", dados: result.data }
            : { status: "erro", motivo: "servidor" };
        else if (result.kind === "network-error")
          estado = { status: "erro", motivo: "rede" };
        else
          estado = {
            status: "erro",
            motivo:
              result.status === 401
                ? "sessao"
                : result.status === 403
                  ? "permissao"
                  : result.status === 404
                    ? "ausente"
                    : "servidor",
          };
        setResposta({ chave, base, estado });
      },
    );
    return () => {
      encerrado = true;
      controller.abort();
    };
  }, [base, chave, path, userId, validar]);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  const estado: LeituraPlataforma<T> =
    resposta?.chave === chave ? resposta.estado : { status: "carregando" };
  /** Dados da leitura ANTERIOR da mesma conta e consulta, só enquanto uma
   * releitura carrega: a tela continua montada (formulários e resultados não
   * somem). Nunca vale para outra consulta nem substitui um erro. */
  const anterior: T | null =
    estado.status === "carregando" &&
    resposta?.base === base &&
    resposta.estado.status === "pronto"
      ? resposta.estado.dados
      : null;
  return { estado, recarregar, anterior };
}
