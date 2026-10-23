"use client";

// Envio de formulário de CRIAÇÃO com chave de idempotência. A chave nasce
// com o formulário e é a mesma em toda nova tentativa: o servidor nunca cria
// duas vezes. Se a resposta se perder (`rede`), a tela NÃO reenvia sozinha:
// mostra "não confirmado" e oferece consultar o resultado pela chave
// (`GET /platform/requests/:chave`). Só depois disso a pessoa decide.
import { useCallback, useState } from "react";
import { apiRequest } from "@/lib/api/http-client";
import { mensagemDoResultado, novaChaveDeFormulario, type ResultadoAcao } from "./api-contas";

export type FaseEnvio<T> =
  | { fase: "parado" }
  | { fase: "enviando" }
  | { fase: "ok"; dados: T }
  | { fase: "incerto" }
  | { fase: "erro"; mensagem: string; podeRepetir: boolean };

export function useEnvioComChave<T>(validar: (valor: unknown) => valor is T) {
  const [chave, setChave] = useState(novaChaveDeFormulario);
  const [estado, setEstado] = useState<FaseEnvio<T>>({ fase: "parado" });

  const enviar = useCallback(
    async (acao: (chave: string) => Promise<ResultadoAcao<unknown>>) => {
      setEstado({ fase: "enviando" });
      const resultado = await acao(chave);
      if (resultado.tipo === "ok") {
        setEstado(
          validar(resultado.dados)
            ? { fase: "ok", dados: resultado.dados }
            : { fase: "erro", mensagem: "Resposta inesperada do servidor. Consulte a lista antes de repetir.", podeRepetir: false },
        );
      } else if (resultado.tipo === "rede") {
        setEstado({ fase: "incerto" });
      } else {
        setEstado({ fase: "erro", mensagem: mensagemDoResultado(resultado), podeRepetir: true });
      }
    },
    [chave, validar],
  );

  const consultar = useCallback(async () => {
    setEstado({ fase: "enviando" });
    const r = await apiRequest<unknown>(`/platform/requests/${chave}`);
    if (r.kind === "success" && validar(r.data)) setEstado({ fase: "ok", dados: r.data });
    else if (r.kind === "http-error" && r.status === 404) {
      setEstado({ fase: "erro", mensagem: "Nada foi criado com este formulário. Você pode enviar de novo.", podeRepetir: true });
    } else setEstado({ fase: "incerto" });
  }, [chave, validar]);

  /** Novo formulário: chave nova. */
  const recomecar = useCallback(() => {
    setChave(novaChaveDeFormulario());
    setEstado({ fase: "parado" });
  }, []);

  return { chave, estado, enviar, consultar, recomecar };
}
