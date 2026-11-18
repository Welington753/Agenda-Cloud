"use client";

// Visão geral do portal da plataforma: totais dos estabelecimentos no alcance
// escolhido (clientes por padrão; internos/teste; todos), pagamentos das
// assinaturas do mês e a lista "Precisa de atenção", todos no mesmo alcance. Tudo vem de `GET /platform/overview`, calculado no servidor com a
// mesma regra de acesso da operação (backend/src/platform/portal-overview.ts).
//
// Carregando, erro e "nada a mostrar" são estados distintos: uma falha nunca
// aparece como zero. Não há MRR, previsão nem inadimplência: acesso vencido
// não comprova dívida. O alcance só é afirmado quando a API o devolve
// (`scope`); uma API anterior, sem o campo, mostra o aviso de não confirmado.
//
// O arranjo (components/administracao/visao-geral-conteudo.tsx) é o mesmo em
// todos os temas: a aparência escolhida muda só as cores, pelos tokens de
// globals.css, nunca a organização nem o que aparece.
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehVisaoGeral, ESCOPO_PADRAO, type EscopoDoDiretorio } from "@/lib/administracao/contratos-diretorio";
import { SeletorDeAlcance, TextoDeAlcance } from "@/components/administracao/alcance-do-portal";
import { dataCadastro } from "@/lib/administracao/contratos";
import { alcanceConfirmado, ehEscopoDoDiretorio } from "@/lib/administracao/diretorio";
import { ConteudoDaVisaoGeral } from "@/components/administracao/visao-geral-conteudo";
import { horaBr } from "@/components/administracao/visao-geral-pecas";

export default function VisaoGeralPage() {
  return (
    <Suspense fallback={<p className="py-12 text-center text-ink-soft">Carregando o portal…</p>}>
      <VisaoGeralDoPortal />
    </Suspense>
  );
}

function VisaoGeralDoPortal() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const pedido = useSearchParams().get("alcance");
  const alcance: EscopoDoDiretorio = ehEscopoDoDiretorio(pedido) ? pedido : ESCOPO_PADRAO;
  // O padrão não vai na consulta: o servidor aplica clientes e devolve `scope`.
  const { estado, recarregar } = useLeituraPlataforma(
    alcance === ESCOPO_PADRAO ? "/platform/overview" : `/platform/overview?scope=${alcance}`,
    ehVisaoGeral,
  );
  const visao = estado.status === "pronto" ? estado.dados : null;
  const escolher = (novo: EscopoDoDiretorio) =>
    router.replace(novo === ESCOPO_PADRAO ? pathname : `${pathname}?alcance=${novo}`, { scroll: false });
  const corpo =
    estado.status !== "pronto" ? (
      <EstadoLeitura estado={estado} recarregar={recarregar} />
    ) : (
      <ConteudoDaVisaoGeral visao={estado.dados} alcance={alcance} />
    );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Atualizar na linha do título; sem espaço (tela estreita ou zoom),
          o `flex-wrap` o leva para a linha de baixo, nunca para fora. */}
      <header>
        <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">Portal da plataforma</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Visão geral</h1>
          <Botao
            variante="secundaria"
            onClick={recarregar}
            disabled={estado.status === "carregando"}
            className="min-h-11"
          >
            <RefreshCw size={16} aria-hidden="true" />
            Atualizar
          </Botao>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Totais dos estabelecimentos, pagamentos do mês e pendências, todos no alcance escolhido.
        </p>
      </header>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <SeletorDeAlcance valor={alcance} aoEscolher={escolher} segmentado />
          {visao && (
            <p className="text-sm text-ink-soft">
              Consultado em {dataCadastro(visao.generatedAt)} às {horaBr(visao.generatedAt)}
            </p>
          )}
        </div>
        {visao && <TextoDeAlcance confirmado={alcanceConfirmado(alcance, visao.scope)} compacto />}
      </div>

      {corpo}
    </div>
  );
}
