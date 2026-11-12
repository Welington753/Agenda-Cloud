"use client";

// Relatórios por período do portal da plataforma (docs/plans/
// portal-relatorios-por-periodo.md): pagamentos das assinaturas do Agenda
// Cloud recebidos no período e cadastros registrados, no alcance escolhido.
// Tudo vem de `GET /platform/reports`, calculado no servidor.
//
// Período na URL: `mes=YYYY-MM` ou `de`+`ate`; sem eles, o servidor aplica o
// mês atual em São Paulo pelo relógio DELE e devolve o período, que é o que a
// tela mostra. Alcance em `alcance` (padrão Clientes, fora da URL). Período e
// alcance só são afirmados quando a resposta os confirma; uma falha, uma API
// anterior (sem a rota) ou uma resposta incompleta nunca aparecem como zero.
//
// Não é faturamento dos estabelecimentos, MRR, previsão nem cobrança.
import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Botao } from "@/components/ui/button";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { SeletorDeAlcance } from "@/components/administracao/alcance-do-portal";
import { RelatorioDoPeriodo as Relatorio } from "@/components/administracao/relatorio-do-periodo";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehRelatorioDoPeriodo, ESCOPO_PADRAO, type EscopoDoDiretorio } from "@/lib/administracao/contratos-diretorio";
import { ehEscopoDoDiretorio } from "@/lib/administracao/diretorio";
import {
  intervaloDoMes,
  lerPeriodoDaUrl,
  mesDoIntervalo,
  mesVizinho,
  parametrosDoPeriodo,
  periodoConfirmado,
  problemaDoPeriodo,
  type Intervalo,
} from "@/lib/administracao/periodo";
import { rotaRelatorio, ROTA_VISAO_GERAL } from "@/lib/administracao/rotas";

const CAMPO =
  "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

export default function RelatoriosPage() {
  return (
    <Suspense fallback={<p className="py-12 text-center text-ink-soft">Carregando o portal…</p>}>
      <Relatorios />
    </Suspense>
  );
}

function Relatorios() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chaveDaUrl = searchParams.toString();
  const urlAtual = new URLSearchParams(chaveDaUrl);
  const { intervalo: pedido, invalido } = lerPeriodoDaUrl(urlAtual);
  const alcanceDaUrl = urlAtual.get("alcance");
  const escopo: EscopoDoDiretorio = ehEscopoDoDiretorio(alcanceDaUrl) ? alcanceDaUrl : ESCOPO_PADRAO;

  const [de, setDe] = useState(pedido?.de ?? "");
  const [ate, setAte] = useState(pedido?.ate ?? "");
  const [erroPeriodo, setErroPeriodo] = useState("");
  useEffect(() => {
    const atual = lerPeriodoDaUrl(new URLSearchParams(chaveDaUrl)).intervalo;
    setDe(atual?.de ?? "");
    setAte(atual?.ate ?? "");
  }, [chaveDaUrl]);

  const consulta = new URLSearchParams();
  if (pedido) {
    consulta.set("from", pedido.de);
    consulta.set("to", pedido.ate);
  }
  if (escopo !== ESCOPO_PADRAO) consulta.set("scope", escopo);
  const busca = consulta.toString();
  const { estado, recarregar, anterior } = useLeituraPlataforma(
    busca ? `/platform/reports?${busca}` : "/platform/reports",
    ehRelatorioDoPeriodo,
  );

  const ir = (periodo: Intervalo | null, alcance: EscopoDoDiretorio) =>
    router.replace(rotaRelatorio({ periodo: parametrosDoPeriodo(periodo), alcance }), { scroll: false });

  // Mês mostrado (para anterior/seguinte): o confirmado pelo servidor, ou o
  // pedido enquanto a resposta não chega.
  const dados = estado.status === "pronto" ? estado.dados : anterior;
  const confirmado = dados ? periodoConfirmado(pedido, dados.period) : null;
  const mesBase = (confirmado && mesDoIntervalo(confirmado)) ?? (pedido && mesDoIntervalo(pedido)) ?? null;

  function aplicar(event: FormEvent) {
    event.preventDefault();
    const problema = problemaDoPeriodo(de, ate);
    setErroPeriodo(problema ?? "");
    if (!problema) ir({ de, ate }, escopo);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Administração do Agenda Cloud</p>
          <h1 className="mt-1 text-2xl font-bold">Relatórios por período</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            Pagamentos das assinaturas do Agenda Cloud recebidos e cadastros registrados no período. Não inclui o dinheiro dos
            atendimentos dos estabelecimentos. A situação de agora (acesso, validade, suspensões) fica na{" "}
            <Link href={ROTA_VISAO_GERAL} className="text-accent hover:underline">
              Visão geral
            </Link>
            .
          </p>
        </div>
        <Botao variante="secundaria" onClick={recarregar} disabled={estado.status === "carregando"} className="min-h-11">
          Atualizar
        </Botao>
      </header>

      <section aria-label="Período" className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2" data-testid="navegacao-de-mes">
          <Botao
            variante="secundaria"
            className="min-h-11"
            disabled={!mesBase}
            onClick={() => mesBase && ir(intervaloDoMes(mesVizinho(mesBase, -1)), escopo)}
          >
            Mês anterior
          </Botao>
          <Botao
            variante="secundaria"
            className="min-h-11"
            disabled={!mesBase}
            onClick={() => mesBase && ir(intervaloDoMes(mesVizinho(mesBase, 1)), escopo)}
          >
            Mês seguinte
          </Botao>
          <Botao variante={pedido ? "secundaria" : "primaria"} className="min-h-11" onClick={() => ir(null, escopo)}>
            Mês atual
          </Botao>
        </div>
        <form onSubmit={aplicar} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]" data-testid="periodo-personalizado">
          <label className="min-w-0 text-sm font-medium">
            Período personalizado: de
            <input type="date" className={CAMPO} value={de} onChange={(e) => setDe(e.target.value)} />
          </label>
          <label className="min-w-0 text-sm font-medium">
            até (inclusive)
            <input type="date" className={CAMPO} value={ate} onChange={(e) => setAte(e.target.value)} />
          </label>
          <Botao type="submit" className="min-h-11">
            Aplicar período
          </Botao>
        </form>
        <p className="text-xs text-ink-soft">
          Datas em horário de Brasília (America/Sao_Paulo), o primeiro e o último dia inclusos. No máximo 366 dias.
        </p>
        {erroPeriodo && (
          <p role="alert" className="text-sm text-danger">
            {erroPeriodo}
          </p>
        )}
        {invalido && (
          <p role="alert" className="text-sm text-danger" data-testid="periodo-invalido-na-url">
            O período do endereço é inválido e foi ignorado: mostrando o mês atual.
          </p>
        )}
      </section>

      <SeletorDeAlcance valor={escopo} aoEscolher={(alcance) => ir(pedido, alcance)} />

      {estado.status !== "pronto" ? (
        <EstadoLeitura
          estado={estado}
          recarregar={recarregar}
          mensagens={{
            ausente: "Os relatórios por período ainda não estão disponíveis neste servidor. Nenhum número foi calculado.",
            recusado: "O servidor recusou este período ou alcance. Nenhum número foi calculado.",
          }}
        />
      ) : !confirmado || estado.dados.scope !== escopo ? (
        <p role="alert" className="rounded-xl border border-border bg-card p-6 text-sm" data-testid="relatorio-nao-confirmado">
          O servidor não confirmou o período ou o alcance pedido. Nenhum número foi mostrado.
        </p>
      ) : (
        <Relatorio relatorio={estado.dados} periodo={confirmado} escopo={escopo} />
      )}
    </div>
  );
}
