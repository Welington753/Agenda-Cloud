// Relatório de um período já confirmado pelo servidor (página
// /portal/relatorios). Só desenha: números, links que abrem exatamente os
// registros de cada indicador e o significado dos números.
import Link from "next/link";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { TextoDeAlcance } from "@/components/administracao/alcance-do-portal";
import type { EscopoDoDiretorio, RelatorioDoPeriodo as Dados } from "@/lib/administracao/contratos-diretorio";
import { alcanceConfirmado } from "@/lib/administracao/diretorio";
import { diaCurto, mesDoIntervalo, textoDoPeriodo, type Intervalo } from "@/lib/administracao/periodo";
import { CICLOS, reais } from "@/lib/administracao/validade";
import { rotaEstabelecimentosFiltrados, rotaPagamentosFiltrados } from "@/lib/administracao/rotas";

const LINK = "inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline";

export function RelatorioDoPeriodo({
  relatorio,
  periodo,
  escopo,
}: {
  relatorio: Dados;
  periodo: Intervalo;
  escopo: EscopoDoDiretorio;
}) {
  const { payments: p, registrations: cadastros } = relatorio;
  return (
    <div className="space-y-6" data-testid="relatorio-do-periodo" data-de={periodo.de} data-ate={periodo.ate} data-alcance={escopo}>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold" data-testid="periodo-aplicado">
          {textoDoPeriodo(periodo)}
          {mesDoIntervalo(periodo) && (
            <span className="font-normal text-ink-soft">
              {" "}
              ({diaCurto(periodo.de)} a {diaCurto(periodo.ate)})
            </span>
          )}
        </h2>
        <TextoDeAlcance confirmado={alcanceConfirmado(escopo, relatorio.scope)} />
        <p className="text-sm text-ink-soft" data-testid="aviso-classificacao-atual">
          A separação entre clientes e internos/teste usa a classificação de agora: marcar ou desmarcar um estabelecimento muda
          também os relatórios de períodos passados.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Cartao>
          <CartaoCorpo className="space-y-2" data-testid="relatorio-recebidos">
            <h3 className="text-sm font-medium text-ink-soft">Pagamentos de assinaturas recebidos</h3>
            <p className="text-3xl font-semibold tracking-tight tabular-nums" data-testid="relatorio-recebidos-total">
              {reais(p.totalCents)}
            </p>
            <p className="text-sm text-ink-soft" data-testid="relatorio-recebidos-quantidade">
              {p.count === 0
                ? "Nenhum pagamento recebido neste período."
                : `${p.count} pagamento(s) registrado(s) manualmente e não anulado(s).`}
            </p>
            <Link
              href={rotaPagamentosFiltrados({ de: periodo.de, ate: periodo.ate, alcance: escopo, situacao: "recebidos" })}
              className={LINK}
              data-testid="link-recebidos"
            >
              Ver pagamentos recebidos
            </Link>
          </CartaoCorpo>
        </Cartao>
        <Cartao>
          <CartaoCorpo className="space-y-2" data-testid="relatorio-anulados">
            <h3 className="text-sm font-medium text-ink-soft">Registros anulados</h3>
            <p className="text-3xl font-semibold tracking-tight tabular-nums" data-testid="relatorio-anulados-quantidade">
              {p.canceledCount}
            </p>
            <p className="text-sm text-ink-soft">
              Com data de recebimento neste período e anulados por correção. Ficam fora da soma.
            </p>
            <Link
              href={rotaPagamentosFiltrados({ de: periodo.de, ate: periodo.ate, alcance: escopo, situacao: "anulados" })}
              className={LINK}
              data-testid="link-anulados"
            >
              Ver registros anulados
            </Link>
          </CartaoCorpo>
        </Cartao>
        <Cartao>
          <CartaoCorpo className="space-y-2" data-testid="relatorio-cadastros">
            <h3 className="text-sm font-medium text-ink-soft">Cadastros registrados no período</h3>
            <p className="text-3xl font-semibold tracking-tight tabular-nums" data-testid="relatorio-cadastros-quantidade">
              {cadastros.count}
            </p>
            <p className="text-sm text-ink-soft">
              Pela data de criação do cadastro. Não são clientes conquistados nem novas assinaturas.
            </p>
            <Link
              href={rotaEstabelecimentosFiltrados({ alcance: escopo, cadastroDe: periodo.de, cadastroAte: periodo.ate })}
              className={LINK}
              data-testid="link-cadastros"
            >
              Ver cadastros
            </Link>
          </CartaoCorpo>
        </Cartao>
      </div>

      <Cartao>
        <CartaoCorpo className="space-y-3" data-testid="relatorio-por-plano">
          <h3 className="font-semibold">Recebidos por plano e ciclo</h3>
          <p className="text-xs text-ink-soft">
            Informativo: os mesmos pagamentos do total acima, pelo plano e ciclo gravados em cada pagamento (o plano da época,
            que pode não ser o atual do estabelecimento).
          </p>
          {relatorio.byPlanCycle.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhum pagamento recebido neste período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-left text-sm">
                <thead className="text-xs text-ink-soft">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Plano
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Ciclo
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Pagamentos
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {relatorio.byPlanCycle.map((g) => (
                    <tr key={`${g.planId}-${g.cycle}`} className="border-t border-border" data-testid="linha-plano-ciclo">
                      <td className="py-2 pr-3">{g.planName}</td>
                      <td className="py-2 pr-3">{CICLOS[g.cycle]}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.count}</td>
                      <td className="py-2 text-right tabular-nums">{reais(g.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="space-y-2 text-xs text-ink-soft" data-testid="significado-dos-numeros">
          <h3 className="text-sm font-semibold text-ink">O que estes números significam</h3>
          <p>
            Pagamentos recebidos: pagamentos das assinaturas do Agenda Cloud registrados manualmente no portal e não anulados
            agora, pela data de recebimento informada. Soma os valores gravados em cada pagamento, sem recalcular pelo catálogo ou
            pelo contrato. Um pagamento trimestral conta inteiro no mês em que foi recebido. Não é faturamento dos
            estabelecimentos, receita recorrente, previsão nem cobrança a vencer.
          </p>
          <p>
            Anulações: uma anulação feita depois muda também este período. O registro sai do total de recebidos e passa para os
            anulados. Anular corrige o registro; não comprova devolução de dinheiro.
          </p>
          <p>
            Cadastros: estabelecimentos cuja data de criação cai no período, inclusive os que depois foram suspensos ou
            arquivados (nenhum fluxo do Agenda Cloud apaga um cadastro). Datas antigas podem refletir importação ou migração de
            dados, e não a data real de entrada.
          </p>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}
