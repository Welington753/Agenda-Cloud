"use client";

// Pagamentos das assinaturas do Agenda Cloud (portal da plataforma): os
// períodos pagos registrados à mão em cada estabelecimento, do mais recente
// ao mais antigo, com os anulados por correção marcados. Só consulta: o
// registro e a correção ficam na ficha de cada estabelecimento.
//
// Não confundir com os recebimentos dos atendimentos (dinheiro que o cliente
// do estabelecimento paga a ele), que nunca aparecem aqui.
import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehListaDePagamentos } from "@/lib/administracao/contratos";
import { CICLOS, diaBr, FORMAS_DE_PAGAMENTO, ORIGEM_DO_VALOR, reais } from "@/lib/administracao/validade";
import { rotaFichaEstabelecimento } from "@/lib/administracao/rotas";

export default function PagamentosDasAssinaturasPage() {
  const [pagina, setPagina] = useState(1);
  const { estado, recarregar } = useLeituraPlataforma(
    `/platform/subscription-payments?page=${pagina}&pageSize=30`,
    ehListaDePagamentos,
  );
  if (estado.status !== "pronto") return <EstadoLeitura estado={estado} recarregar={recarregar} />;
  const lista = estado.dados;
  const paginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pagamentos das assinaturas</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Pagamentos da assinatura do Agenda Cloud, confirmados manualmente pela administração. Os recebimentos dos
            atendimentos de cada estabelecimento são outra coisa e não aparecem aqui.
          </p>
        </div>
        <Botao variante="secundaria" onClick={recarregar} className="min-h-11">
          Atualizar
        </Botao>
      </header>
      {lista.items.length === 0 ? (
        <Cartao>
          <CartaoCorpo>
            <p className="text-sm text-ink-soft">Nenhum pagamento de assinatura registrado.</p>
          </CartaoCorpo>
        </Cartao>
      ) : (
        <ul className="space-y-3" data-testid="lista-pagamentos-assinaturas">
          {lista.items.map((p) => (
            <li key={p.id}>
              <Cartao>
                <CartaoCorpo className="space-y-1 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={rotaFichaEstabelecimento(p.tenant.id)} className="font-semibold text-accent hover:underline">
                      {p.tenant.name}
                    </Link>
                    <span className="font-semibold">{reais(p.amountCents)}</span>
                  </div>
                  <p>
                    {p.planName} · {CICLOS[p.cycle]} · {FORMAS_DE_PAGAMENTO[p.paymentMethod] ?? p.paymentMethod} · recebido em{" "}
                    {diaBr(p.receivedOn)}
                    {p.amountSource ? ` · ${ORIGEM_DO_VALOR[p.amountSource]}` : ""}
                  </p>
                  <p className="text-xs text-ink-soft">
                    Registrado por {p.recordedBy}
                    {p.reference ? ` · referência ${p.reference}` : ""}
                  </p>
                  {p.canceled && (
                    <Badge cor="aviso">Anulado por correção{p.canceled.reason ? `: ${p.canceled.reason}` : ""}</Badge>
                  )}
                </CartaoCorpo>
              </Cartao>
            </li>
          ))}
        </ul>
      )}
      {paginas > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Botao variante="secundaria" className="min-h-11" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
            Anterior
          </Botao>
          <span className="text-sm">
            Página {lista.page} de {paginas}
          </span>
          <Botao variante="secundaria" className="min-h-11" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>
            Próxima
          </Botao>
        </div>
      )}
    </div>
  );
}
