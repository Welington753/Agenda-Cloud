// Visão geral do portal no tema "Azul e branco": mesmos dados, números,
// links e `data-testid` do arranjo de sempre (page.tsx), em outra
// organização — três indicadores no topo, "Modalidade do acesso" ao lado de
// "Atenção" e dos pagamentos, e a lista de estabelecimentos por último.
import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Ban, Building2, ChevronRight, CircleCheck } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import type { EscopoDoDiretorio, VisaoGeral } from "@/lib/administracao/contratos-diretorio";
import { FILTROS, textoModalidade } from "@/lib/administracao/diretorio";
import { rotaEstabelecimentosFiltrados } from "@/lib/administracao/rotas";
import {
  DETALHE_CONTRATO,
  DETALHE_LIBERADOS,
  detalheBloqueados,
  Indicador,
  ItensDeAtencao,
  MODALIDADES,
  Pagamentos,
  ROTULO_CONTRATO,
  ROTULO_VENCENDO,
  rotuloDoTotal,
} from "./visao-geral-pecas";

export function ConteudoAzul({ visao, alcance }: { visao: VisaoGeral; alcance: EscopoDoDiretorio }) {
  const e = visao.establishments;
  const rota = (filtro: { filtro?: string; situacao?: string }) => rotaEstabelecimentosFiltrados({ ...filtro, alcance });
  const { attention } = visao;
  return (
    <>
      <section aria-label="Estabelecimentos" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Indicador
          azul
          destaque
          href={rota({})}
          icone={Building2}
          rotulo={rotuloDoTotal(alcance, visao)}
          valor={e.total}
          testId="indicador-total"
        />
        <Indicador
          azul
          href={rota({ filtro: "ACCESS_ALLOWED" })}
          icone={CircleCheck}
          rotulo="Com acesso liberado"
          valor={e.allowed}
          detalhe={DETALHE_LIBERADOS}
          testId="indicador-liberados"
        />
        <Indicador
          azul
          href={rota({ filtro: "ACCESS_BLOCKED" })}
          icone={Ban}
          rotulo="Com acesso bloqueado"
          valor={e.blocked}
          detalhe={detalheBloqueados(e)}
          testId="indicador-bloqueados"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Cartao>
          <CartaoCorpo>
            <section aria-labelledby="titulo-modalidades">
              <h2 id="titulo-modalidades" className="text-lg font-semibold">
                Modalidade do acesso
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                Validade da assinatura de cada estabelecimento, independente da situação do cadastro.
              </p>
              <dl className="mt-3 divide-y divide-border border-t border-border" data-testid="modalidades">
                {MODALIDADES.map((m) => (
                  <div key={m} className="flex min-h-11 items-center justify-between gap-3 py-2">
                    <dt className="text-sm">{textoModalidade(m)}</dt>
                    <dd className="font-semibold tabular-nums">{e.byState[m]}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </CartaoCorpo>
        </Cartao>

        <div className="space-y-4">
          <Cartao>
            <CartaoCorpo>
              <section aria-labelledby="titulo-resumo-atencao" data-testid="resumo-atencao">
                <h2 id="titulo-resumo-atencao" className="text-lg font-semibold">
                  Atenção
                </h2>
                <ul className="mt-2 divide-y divide-border">
                  <LinhaDeAtencao
                    href={rota({ filtro: "CONTRACT_PENDING" })}
                    rotulo={ROTULO_CONTRATO}
                    detalhe={DETALHE_CONTRATO}
                    valor={e.contractPending}
                    testId="indicador-contrato-pendente"
                  />
                  <LinhaDeAtencao
                    href={rota({ filtro: "EXPIRING_SOON" })}
                    rotulo={ROTULO_VENCENDO}
                    valor={e.expiringSoon}
                    testId="indicador-vencendo"
                  />
                  <LinhaDeAtencao
                    href={rota({ filtro: "VALIDITY_BLOCKED" })}
                    rotulo={FILTROS.VALIDITY_BLOCKED.rotulo}
                    valor={e.validityBlocked}
                    grave
                    testId="atalho-validade-vencida"
                  />
                  <LinhaDeAtencao
                    href={rota({ situacao: "SUSPENDED" })}
                    rotulo="Suspensos"
                    valor={e.suspended}
                    testId="indicador-suspensos"
                  />
                </ul>
                <p className="mt-2 text-xs text-ink-soft">
                  Cada linha abre a lista filtrada, que inclui também suspensos e arquivados.
                </p>
              </section>
            </CartaoCorpo>
          </Cartao>
          <Pagamentos pagamentos={visao.payments} alcance={alcance} azul />
        </div>
      </div>

      <Cartao>
        <CartaoCorpo>
          <section aria-labelledby="titulo-atencao" className="space-y-3">
            <div>
              <h2 id="titulo-atencao" className="text-lg font-semibold">
                Estabelecimentos que precisam de atenção
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                Só estabelecimentos em operação com a validade vencida, ausente ou terminando em até 7 dias.
              </p>
            </div>
            <ItensDeAtencao visao={visao} azul />
            {attention.total > attention.items.length && (
              <p className="text-sm text-ink-soft">
                Mostrando {attention.items.length} de {attention.total}. Os demais estão nas linhas de Atenção acima.
              </p>
            )}
          </section>
        </CartaoCorpo>
      </Cartao>
    </>
  );
}

/** Linha do cartão "Atenção" (tema azul): leva à lista filtrada. Número acima
 * de zero ganha a cor de aviso (ou de erro, quando o acesso já parou). */
function LinhaDeAtencao({
  href,
  rotulo,
  detalhe,
  valor,
  grave = false,
  testId,
}: {
  href: string;
  rotulo: string;
  detalhe?: string;
  valor: number;
  grave?: boolean;
  testId: string;
}): ReactNode {
  return (
    <li>
      <Link
        href={href}
        data-testid={testId}
        className="group -mx-2 flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-2 py-2.5 hover:bg-paper-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{rotulo}</span>
          {detalhe && <span className="block text-xs text-ink-soft">{detalhe}</span>}
        </span>
        <span
          data-testid={`${testId}-valor`}
          className={clsx(
            "min-w-8 rounded-full px-2.5 py-0.5 text-center text-sm font-bold tabular-nums",
            valor === 0
              ? "text-ink-soft"
              : grave
                ? "bg-danger-soft text-[color:var(--color-danger)]"
                : "bg-warning-soft text-[color:var(--color-warning)]",
          )}
        >
          {valor}
        </span>
        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-soft group-hover:text-accent" />
      </Link>
    </li>
  );
}
