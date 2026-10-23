"use client";

// O que aconteceu com um formulário de criação: criado (com o estado do
// e-mail), não confirmado (resposta perdida: consultar antes de repetir) ou
// recusado (com o motivo do servidor).
import type { ReactNode } from "react";
import { Botao } from "@/components/ui/button";
import type { FaseEnvio } from "@/lib/administracao/use-envio-com-chave";

export function ResultadoEnvio<T>({
  estado,
  aoConsultar,
  aoRepetir,
  sucesso,
}: {
  estado: FaseEnvio<T>;
  aoConsultar: () => void;
  aoRepetir?: () => void;
  sucesso: (dados: T) => ReactNode;
}) {
  if (estado.fase === "parado") return null;
  if (estado.fase === "enviando")
    return (
      <p role="status" className="text-sm text-ink-soft">
        Enviando…
      </p>
    );
  if (estado.fase === "ok") return <div data-testid="resultado-envio">{sucesso(estado.dados)}</div>;
  if (estado.fase === "incerto")
    return (
      <div role="alert" className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
        <p>
          A resposta do servidor não chegou. O pedido pode ter sido gravado: consulte o resultado antes de tentar de
          novo.
        </p>
        <Botao variante="secundaria" onClick={aoConsultar} className="min-h-11">
          Consultar resultado
        </Botao>
      </div>
    );
  return (
    <div role="alert" className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
      <p>{estado.mensagem}</p>
      {estado.podeRepetir && aoRepetir && (
        <Botao variante="secundaria" onClick={aoRepetir} className="min-h-11">
          Corrigir e tentar de novo
        </Botao>
      )}
    </div>
  );
}
