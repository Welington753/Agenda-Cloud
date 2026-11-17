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
// Tema "Azul e branco" (useTemaAzul): mesma leitura, mesmos números, links e
// `data-testid`, em outro arranjo (components/administracao/
// visao-geral-azul.tsx). Os outros temas continuam com o arranjo de sempre.
// Até a hidratação vale o arranjo de sempre; os dados só chegam depois, então
// o conteúdo já aparece no arranjo escolhido.
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, CalendarClock, CircleCheck, Ban, FileQuestion, PauseCircle, RefreshCw } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { useTemaAzul } from "@/lib/aparencia/use-aparencia";
import { ehVisaoGeral, ESCOPO_PADRAO, type EscopoDoDiretorio, type VisaoGeral } from "@/lib/administracao/contratos-diretorio";
import { SeletorDeAlcance, TextoDeAlcance } from "@/components/administracao/alcance-do-portal";
import { dataCadastro } from "@/lib/administracao/contratos";
import { alcanceConfirmado, ehEscopoDoDiretorio, FILTROS, textoModalidade } from "@/lib/administracao/diretorio";
import { rotaEstabelecimentosFiltrados } from "@/lib/administracao/rotas";
import { ConteudoAzul } from "@/components/administracao/visao-geral-azul";
import {
  DETALHE_CONTRATO,
  DETALHE_LIBERADOS,
  DETALHE_VENCENDO,
  detalheBloqueados,
  horaBr,
  Indicador,
  ItensDeAtencao,
  MODALIDADES,
  Pagamentos,
  ROTULO_CONTRATO,
  ROTULO_VENCENDO,
  rotuloDoTotal,
} from "@/components/administracao/visao-geral-pecas";

function Atencao({ visao, alcance }: { visao: VisaoGeral; alcance: EscopoDoDiretorio }) {
  const { attention, establishments } = visao;
  return (
    <section aria-labelledby="titulo-atencao" className="space-y-3">
      <h2 id="titulo-atencao" className="text-lg font-semibold">
        Precisa de atenção
      </h2>
      <ItensDeAtencao visao={visao} azul={false} />
      {attention.total > attention.items.length && (
        <p className="text-sm text-ink-soft">
          Mostrando {attention.items.length} de {attention.total}. Os demais estão nos filtros abaixo.
        </p>
      )}
      <ul className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["EXPIRING_SOON", establishments.expiringSoon],
            ["VALIDITY_BLOCKED", establishments.validityBlocked],
            ["CONTRACT_PENDING", establishments.contractPending],
          ] as const
        ).map(([filtro, total]) => (
          <li key={filtro}>
            <Link
              href={rotaEstabelecimentosFiltrados({ filtro, alcance })}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 font-medium hover:bg-paper-muted"
            >
              {FILTROS[filtro].rotulo}: {total}
            </Link>
          </li>
        ))}
        <li>
          <Link
            href={rotaEstabelecimentosFiltrados({ situacao: "SUSPENDED", alcance })}
            className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 font-medium hover:bg-paper-muted"
          >
            Suspensos: {establishments.suspended}
          </Link>
        </li>
      </ul>
      <p className="text-xs text-ink-soft">
        A lista acima traz só estabelecimentos em operação; os filtros incluem também suspensos e arquivados.
      </p>
    </section>
  );
}

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
  const azul = useTemaAzul();
  const corpo =
    estado.status !== "pronto" ? (
      <EstadoLeitura estado={estado} recarregar={recarregar} />
    ) : azul ? (
      <ConteudoAzul visao={estado.dados} alcance={alcance} />
    ) : (
      <Conteudo visao={estado.dados} alcance={alcance} />
    );

  if (azul)
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

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Visão geral</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Totais dos estabelecimentos, pagamentos do mês e pendências, todos no alcance escolhido.
          </p>
          {visao && (
            <p className="mt-1 text-xs text-ink-soft">
              Consultado em {dataCadastro(visao.generatedAt)} às {horaBr(visao.generatedAt)}. Use Atualizar para ler de novo.
            </p>
          )}
        </div>
        <Botao variante="secundaria" onClick={recarregar} disabled={estado.status === "carregando"} className="min-h-11">
          Atualizar
        </Botao>
      </header>

      <div className="space-y-2">
        <SeletorDeAlcance valor={alcance} aoEscolher={escolher} />
        {visao && <TextoDeAlcance confirmado={alcanceConfirmado(alcance, visao.scope)} />}
      </div>

      {corpo}
    </div>
  );
}

function Conteudo({ visao, alcance }: { visao: VisaoGeral; alcance: EscopoDoDiretorio }) {
  const e = visao.establishments;
  const rota = (filtro: { filtro?: string; situacao?: string }) => rotaEstabelecimentosFiltrados({ ...filtro, alcance });
  const rotuloTotal = rotuloDoTotal(alcance, visao);
  return (
    <>
      <section aria-label="Estabelecimentos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Indicador href={rota({})} icone={Building2} rotulo={rotuloTotal} valor={e.total} testId="indicador-total" />
        <Indicador
          href={rota({ filtro: "ACCESS_ALLOWED" })}
          icone={CircleCheck}
          rotulo="Com acesso liberado"
          valor={e.allowed}
          detalhe={DETALHE_LIBERADOS}
          testId="indicador-liberados"
        />
        <Indicador
          href={rota({ filtro: "ACCESS_BLOCKED" })}
          icone={Ban}
          rotulo="Com acesso bloqueado"
          valor={e.blocked}
          detalhe={detalheBloqueados(e)}
          testId="indicador-bloqueados"
        />
        <Indicador
          href={rota({ filtro: "EXPIRING_SOON" })}
          icone={CalendarClock}
          rotulo={ROTULO_VENCENDO}
          valor={e.expiringSoon}
          detalhe={DETALHE_VENCENDO}
          testId="indicador-vencendo"
        />
        <Indicador
          href={rota({ situacao: "SUSPENDED" })}
          icone={PauseCircle}
          rotulo="Suspensos"
          valor={e.suspended}
          testId="indicador-suspensos"
        />
        <Indicador
          href={rota({ filtro: "CONTRACT_PENDING" })}
          icone={FileQuestion}
          rotulo={ROTULO_CONTRATO}
          valor={e.contractPending}
          detalhe={DETALHE_CONTRATO}
          testId="indicador-contrato-pendente"
        />
      </section>

      <section aria-labelledby="titulo-modalidades" className="space-y-3">
        <h2 id="titulo-modalidades" className="text-lg font-semibold">
          Modalidade do acesso
        </h2>
        <p className="text-sm text-ink-soft">
          Validade da assinatura de cada estabelecimento, independente da situação do cadastro.
        </p>
        <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="modalidades">
          {MODALIDADES.map((m) => (
            <div key={m} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-card px-3 py-2">
              <dt className="text-sm">{textoModalidade(m)}</dt>
              <dd className="font-semibold tabular-nums">{e.byState[m]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Pagamentos pagamentos={visao.payments} alcance={alcance} />
      <Atencao visao={visao} alcance={alcance} />
    </>
  );
}
