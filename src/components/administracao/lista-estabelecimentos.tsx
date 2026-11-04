import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge, type CorBadge } from "@/components/ui/badge-base";
import { dataCadastro } from "@/lib/administracao/contratos";
import type { AcessoEfetivo, ItemDoDiretorio } from "@/lib/administracao/contratos-diretorio";
import {
  ACESSO_EFETIVO,
  linhaCatalogo,
  linhasContratadas,
  textoModalidade,
  textoSituacao,
  textoValidade,
} from "@/lib/administracao/diretorio";
import { CICLOS } from "@/lib/administracao/validade";
import { rotaFichaEstabelecimento } from "@/lib/administracao/rotas";

const COR_DO_ACESSO: Record<AcessoEfetivo, CorBadge> = {
  ALLOWED: "sucesso",
  BLOCKED_STATUS: "neutro",
  BLOCKED_VALIDITY: "aviso",
};

const COLUNAS = "lg:grid-cols-[1.6fr_1.6fr_1.8fr_1.6fr]";

function Condicao({ item }: { item: ItemDoDiretorio }) {
  const contratadas = linhasContratadas(item.commercial);
  const agreed = item.commercial.agreedCycle;
  return (
    <div className="min-w-0 text-sm" data-testid="condicao-contratada">
      <p className="mb-1 text-xs text-ink-soft lg:hidden">Plano e condição</p>
      <p className="font-medium">{item.plan.name}</p>
      <p className="text-xs text-ink-soft">Condição contratada</p>
      {contratadas.length ? (
        <ul>
          {contratadas.map((linha) => (
            <li key={linha} className="break-words">
              {linha}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[color:var(--color-warning)]">Pendente: sem valor contratado</p>
      )}
      {contratadas.length > 1 && agreed && (
        <p className="text-xs text-ink-soft">Último registrado: {CICLOS[agreed].toLowerCase()}</p>
      )}
      <p className="mt-1 break-words text-xs text-ink-soft">{linhaCatalogo(item.commercial)}</p>
    </div>
  );
}

export function ListaEstabelecimentos({ items }: { items: ItemDoDiretorio[] }) {
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
        className={`hidden gap-4 px-5 text-xs font-semibold uppercase tracking-wide text-ink-soft lg:grid ${COLUNAS}`}
      >
        <span>Estabelecimento</span>
        <span>Responsável</span>
        <span>Plano e condição</span>
        <span>Situação e acesso</span>
      </div>
      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            data-testid="item-estabelecimento"
            className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
          >
            <div className={`grid min-w-0 gap-4 lg:items-start ${COLUNAS}`}>
              <div className="min-w-0">
                <Link
                  href={rotaFichaEstabelecimento(item.id)}
                  className="inline-flex min-h-11 max-w-full items-center gap-2 break-words font-semibold text-ink hover:text-accent"
                >
                  <span className="min-w-0 break-words">{item.name}</span>
                  <ArrowUpRight size={16} className="shrink-0" aria-hidden="true" />
                </Link>
                <p className="break-all text-xs text-ink-soft">{item.slug}</p>
                <p className="mt-1 text-xs text-ink-soft">Cadastro em {dataCadastro(item.createdAt)}</p>
              </div>
              <div className="min-w-0 text-sm">
                <p className="mb-1 text-xs text-ink-soft lg:hidden">Responsável</p>
                {item.owners.length ? (
                  <>
                    <p className="break-words font-medium">{item.owners[0].name}</p>
                    <p className="break-all text-ink-soft">{item.owners[0].email}</p>
                    {item.owners.length > 1 && (
                      <p className="text-xs text-ink-soft">+{item.owners.length - 1} responsável(is) na ficha</p>
                    )}
                  </>
                ) : (
                  <p className="text-ink-soft">Sem responsável vinculado</p>
                )}
              </div>
              <Condicao item={item} />
              <div className="min-w-0 space-y-1 text-sm" data-testid="situacao-e-acesso">
                <p className="mb-1 text-xs text-ink-soft lg:hidden">Situação e acesso</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge cor={item.operational === "ACTIVE" ? "info" : "neutro"}>
                    {textoSituacao(item.status, item.operational)}
                  </Badge>
                  <Badge cor={COR_DO_ACESSO[item.access.effective]}>{ACESSO_EFETIVO[item.access.effective]}</Badge>
                </div>
                <p className="font-medium">{textoModalidade(item.access.state, item.access.expiredKind)}</p>
                <p className="text-ink-soft">{textoValidade(item.access, item.timezone)}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
