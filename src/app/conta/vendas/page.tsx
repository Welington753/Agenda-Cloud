"use client";

// Vendas (`/conta/vendas`, adicional VENDAS; docs/plans/vendas-v1.md):
//
// - "Nova venda": quem registra vendas, com VENDAS e ESTOQUE ativos;
// - "Minhas operações": as vendas e os recebimentos que a própria pessoa
//   registrou, com a situação de cada um (quem recebe, recebe dali);
// - "Vendas" e "Recebimentos de vendas": a consulta geral, com os totais do
//   período.
//
// Cada aba só aparece com a área que o servidor liberou na sessão. Sem o
// adicional (retirado), a nova venda some e a manutenção das vendas já
// registradas continua. A tela só esconde: quem recusa é a API.
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { ReautenticacaoProvider } from "@/components/administracao/reautenticacao";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useAreas } from "@/lib/conta/use-areas";
import { ROTULO_ABA, abaInicial, abasDisponiveis, type AbaDeVendas } from "@/lib/vendas/apresentacao";
import { ListaDeVendas } from "./lista-de-vendas";
import { NovaVenda } from "./nova-venda";
import { RecebimentosDeVendas } from "./recebimentos-de-vendas";

export default function VendasPage() {
  const { estado: sessao } = useRealAuth();
  const tem = useAreas();
  const { notificar } = useToast();
  const disponiveis = abasDisponiveis(tem);
  const chaveDasAbas = disponiveis.join(",");
  const [aba, setAba] = useState<AbaDeVendas | null>(null);
  const [versao, setVersao] = useState(0);
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const userId = sessao.status === "autenticado" ? sessao.sessao.user.id : null;

  // Aba do endereço (`?aba=`), se a sessão a vê; senão a primeira.
  useEffect(() => {
    const pedida = new URLSearchParams(window.location.search).get("aba");
    setAba((atual) => abaInicial(atual ?? pedida, chaveDasAbas ? (chaveDasAbas.split(",") as AbaDeVendas[]) : []));
  }, [chaveDasAbas]);

  const escolher = useCallback((nova: AbaDeVendas) => {
    setAba(nova);
    const url = new URL(window.location.href);
    url.searchParams.set("aba", nova);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const mudou = useCallback(
    (mensagem?: string) => {
      if (mensagem) notificar(mensagem, "sucesso");
      setVersao((v) => v + 1);
    },
    [notificar],
  );

  if (sessao.status !== "autenticado" || !tenantId || !userId) return null;

  return (
    <ReautenticacaoProvider>
      <PaginaConta titulo="Vendas" descricao="Venda de produtos e o recebimento de cada venda, como operações separadas.">
        {disponiveis.length === 0 ? (
          <Cartao>
            <CartaoCorpo>
              <p className="text-sm text-ink" data-testid="vendas-indisponivel">
                Vendas não está disponível para sua conta neste estabelecimento. Fale com o responsável.
              </p>
            </CartaoCorpo>
          </Cartao>
        ) : (
          <>
            {disponiveis.length > 1 && (
              <nav aria-label="Seções de vendas" data-testid="abas-vendas">
                <ul className="grid grid-cols-2 gap-1 border-b border-border sm:flex">
                  {disponiveis.map((a) => (
                    <li key={a} className="min-w-0 sm:flex-none">
                      <button
                        type="button"
                        aria-current={aba === a ? "page" : undefined}
                        onClick={() => escolher(a)}
                        className={clsx(
                          "-mb-px flex min-h-11 w-full items-center justify-center border-b-2 px-3 text-center text-sm font-medium",
                          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
                          aba === a ? "border-[color:var(--color-accent)] text-ink" : "border-transparent text-ink-soft hover:text-ink",
                        )}
                        data-testid={`aba-${a}`}
                      >
                        {ROTULO_ABA[a]}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            )}

            {aba === "nova" && (
              <NovaVenda tenantId={tenantId} podeAlterarPreco={tem("VENDAS_ALTERAR_PRECO")} podeReceber={tem("VENDAS_RECEBER")} aoMudar={() => mudou()} />
            )}
            {aba === "minhas" && (
              <div className="space-y-8">
                <div className="space-y-2">
                  <h2 className="text-base font-semibold text-ink">Vendas que você registrou</h2>
                  <ListaDeVendas
                    tenantId={tenantId}
                    userId={userId}
                    escopo="mine"
                    podeReceber={tem("VENDAS_RECEBER")}
                    podeReceberDeOutros={false}
                    versao={versao}
                    aoMudar={mudou}
                  />
                </div>
                <div className="space-y-2">
                  <h2 className="text-base font-semibold text-ink">Recebimentos que você registrou</h2>
                  <RecebimentosDeVendas tenantId={tenantId} escopo="mine" versao={versao} />
                </div>
              </div>
            )}
            {aba === "todas" && (
              <ListaDeVendas
                tenantId={tenantId}
                userId={userId}
                escopo="all"
                podeReceber={tem("VENDAS_RECEBER")}
                podeReceberDeOutros={tem("VENDAS_VER_TODAS")}
                versao={versao}
                aoMudar={mudou}
              />
            )}
            {aba === "recebimentos" && <RecebimentosDeVendas tenantId={tenantId} escopo="all" versao={versao} />}
          </>
        )}
      </PaginaConta>
    </ReautenticacaoProvider>
  );
}
