"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Botao } from "@/components/ui/button";

/** Destino de bloqueio de acesso direto por rota — nunca depende só de esconder o
 * item no menu. Recebe o motivo (vindo de `calcularAcessoEfetivo`) por query
 * string só para exibição; a decisão em si já foi tomada antes de chegar aqui. */
export default function PaginaAcessoNegado() {
  return (
    <Suspense fallback={null}>
      <ConteudoAcessoNegado />
    </Suspense>
  );
}

function ConteudoAcessoNegado() {
  const params = useSearchParams();
  const motivo = params.get("motivo");
  const voltar = params.get("voltar") ?? "/";

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-danger-soft text-[color:var(--color-danger)]">
          <ShieldAlert size={28} />
        </div>
        <h1 className="text-xl font-bold text-ink">Acesso não permitido</h1>
        <p className="text-sm text-ink-soft">{motivo ?? "Você não tem permissão para acessar esta página."}</p>
        <Link href={voltar}>
          <Botao variante="secundaria">Voltar</Botao>
        </Link>
      </div>
    </div>
  );
}
