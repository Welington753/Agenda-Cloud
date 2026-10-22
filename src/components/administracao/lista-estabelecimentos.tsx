import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  SITUACOES,
  dataCadastro,
  precoCatalogo,
  type EstabelecimentoAdministrado,
} from "@/lib/administracao/contratos";

export function ListaEstabelecimentos({
  items,
}: {
  items: EstabelecimentoAdministrado[];
}) {
  if (!items.length)
    return (
      <p className="rounded-xl border border-border bg-card p-8 text-center text-ink-soft">
        Nenhum estabelecimento encontrado para estes filtros.
      </p>
    );
  return (
    <div className="space-y-3">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[2fr_2fr_1.2fr_1fr] gap-4 px-5 text-xs font-semibold uppercase tracking-wide text-ink-soft lg:grid"
      >
        <span>Estabelecimento</span>
        <span>Responsável</span>
        <span>Plano / preço do catálogo</span>
        <span>Situação do acesso</span>
      </div>
      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
          >
            <div className="grid min-w-0 gap-4 lg:grid-cols-[2fr_2fr_1.2fr_1fr] lg:items-center">
              <div className="min-w-0">
                <Link
                  href={`/administracao/estabelecimentos/${encodeURIComponent(item.id)}`}
                  className="inline-flex min-h-11 max-w-full items-center gap-2 break-words font-semibold text-ink hover:text-accent"
                >
                  <span className="min-w-0 break-words">{item.name}</span>
                  <ArrowUpRight
                    size={16}
                    className="shrink-0"
                    aria-hidden="true"
                  />
                </Link>
                <p className="break-all text-xs text-ink-soft">{item.slug}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Cadastro em {dataCadastro(item.createdAt)}
                </p>
              </div>
              <div className="min-w-0 text-sm">
                <p className="mb-1 text-xs text-ink-soft lg:hidden">
                  Responsável
                </p>
                {item.owners.length ? (
                  <>
                    <p className="break-words font-medium">
                      {item.owners[0].name}
                    </p>
                    <p className="break-all text-ink-soft">
                      {item.owners[0].email}
                    </p>
                    {item.owners.length > 1 && (
                      <p className="text-xs text-ink-soft">
                        +{item.owners.length - 1} responsável(is) na ficha
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-ink-soft">Sem responsável vinculado</p>
                )}
              </div>
              <div className="text-sm">
                <p className="font-medium">{item.plan.name}</p>
                <p className="text-ink-soft">
                  {precoCatalogo(item.plan.catalogPriceCents)}
                </p>
                <p className="text-xs text-ink-soft lg:hidden">
                  Preço do catálogo
                </p>
              </div>
              <div>
                <span className="inline-flex rounded-full bg-paper-muted px-3 py-1 text-xs font-semibold">
                  {SITUACOES[item.status]}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
