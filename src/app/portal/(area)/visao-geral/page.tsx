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
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Ban, Building2, CalendarClock, CircleCheck, FileQuestion, PauseCircle, type LucideIcon } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import {
  ehVisaoGeral,
  ESCOPO_PADRAO,
  type EscopoDoDiretorio,
  type MotivoDeAtencao,
  type VisaoGeral,
} from "@/lib/administracao/contratos-diretorio";
import { SeletorDeAlcance, TextoDeAlcance } from "@/components/administracao/alcance-do-portal";
import type { EstadoComercial } from "@/lib/administracao/contratos-validade";
import { dataCadastro } from "@/lib/administracao/contratos";
import {
  alcanceConfirmado,
  ehEscopoDoDiretorio,
  FILTROS,
  textoMes,
  textoModalidade,
  textoValidade,
} from "@/lib/administracao/diretorio";
import { diaBr, reais } from "@/lib/administracao/validade";
import {
  rotaEstabelecimentosFiltrados,
  rotaFichaEstabelecimento,
  rotaPagamentosFiltrados,
  rotaRelatorio,
} from "@/lib/administracao/rotas";

const MOTIVO: Record<MotivoDeAtencao, string> = {
  VALIDITY_BLOCKED: "Em operação, mas sem acesso: validade vencida ou ausente",
  EXPIRING_SOON: "Validade termina em até 7 dias",
};

const MODALIDADES: readonly EstadoComercial[] = ["TRIAL", "PAID", "COURTESY", "NO_EXPIRY", "UNTRACKED", "MISSING", "EXPIRED"];

function Indicador({
  href,
  icone: Icone,
  rotulo,
  valor,
  detalhe,
  testId,
}: {
  href: string;
  icone: LucideIcon;
  rotulo: string;
  valor: number;
  detalhe?: string;
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="group block rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <Cartao className="h-full transition-colors group-hover:border-border-strong">
        <CartaoCorpo className="flex h-full items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-paper-muted text-ink-soft">
            <Icone size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink-soft">{rotulo}</p>
            <p className="text-2xl font-semibold tracking-tight text-ink tabular-nums" data-testid={`${testId}-valor`}>
              {valor}
            </p>
            {detalhe && <p className="mt-1 text-xs text-ink-soft">{detalhe}</p>}
          </div>
          <ArrowUpRight size={16} aria-hidden="true" className="shrink-0 text-ink-soft group-hover:text-ink" />
        </CartaoCorpo>
      </Cartao>
    </Link>
  );
}

function Pagamentos({ pagamentos, alcance }: { pagamentos: VisaoGeral["payments"]; alcance: EscopoDoDiretorio }) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-3" data-testid="pagamentos-do-mes">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-semibold">Pagamentos de assinaturas em {textoMes(pagamentos.month)}</h2>
          <div className="flex flex-wrap gap-x-4">
            <Link
              href={rotaPagamentosFiltrados({ de: pagamentos.from, ate: pagamentos.to, alcance, situacao: "recebidos" })}
              className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline"
              data-testid="link-pagamentos-do-mes"
            >
              Ver pagamentos
            </Link>
            <Link
              href={rotaRelatorio({ alcance })}
              className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline"
              data-testid="link-outros-meses"
            >
              Ver outros meses
            </Link>
          </div>
        </div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums" data-testid="pagamentos-do-mes-total">
          {reais(pagamentos.totalCents)}
        </p>
        <p className="text-sm text-ink-soft" data-testid="pagamentos-do-mes-quantidade">
          {pagamentos.count === 0
            ? "Nenhum pagamento confirmado no período."
            : `${pagamentos.count} pagamento(s) confirmado(s) manualmente.`}
        </p>
        <p className="text-xs text-ink-soft" data-testid="pagamentos-alcance">
          Só pagamentos dos estabelecimentos no alcance escolhido acima. Ver pagamentos abre o extrato com os mesmos filtros:
          recebidos neste mês, não anulados, no mesmo alcance.
        </p>
        <p className="text-xs text-ink-soft">
          Critério: pagamentos das assinaturas do TimVix confirmados manualmente no portal, não anulados, com data de
          recebimento registrada entre {diaBr(pagamentos.from)} e {diaBr(pagamentos.to)} (horário de Brasília,{" "}
          {pagamentos.timeZone}). Soma os valores registrados em cada pagamento, sem recalcular pelo catálogo ou pelo
          contrato atual. Não inclui recebimentos dos atendimentos dos estabelecimentos e não é receita recorrente nem
          previsão.
        </p>
        {pagamentos.canceledCount > 0 && (
          <p className="text-xs text-ink-soft" data-testid="pagamentos-anulados">
            {pagamentos.canceledCount} registro(s) anulado(s) por correção no período não entram na soma. Anular corrige o
            registro; não é estorno bancário.
          </p>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}

function Atencao({ visao, alcance }: { visao: VisaoGeral; alcance: EscopoDoDiretorio }) {
  const { attention, establishments } = visao;
  return (
    <section aria-labelledby="titulo-atencao" className="space-y-3">
      <h2 id="titulo-atencao" className="text-lg font-semibold">
        Precisa de atenção
      </h2>
      {attention.items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-ink-soft" data-testid="atencao-vazia">
          Nenhum estabelecimento em operação está com a validade vencida, ausente ou terminando nos próximos 7 dias.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="lista-atencao">
          {attention.items.map((item) => (
            <li key={item.tenant.id} className="rounded-xl border border-border bg-card p-4">
              <Link
                href={rotaFichaEstabelecimento(item.tenant.id)}
                className="inline-flex min-h-11 max-w-full items-center gap-2 font-semibold text-ink hover:text-accent"
              >
                <span className="min-w-0 break-words">{item.tenant.name}</span>
                <ArrowUpRight size={16} className="shrink-0" aria-hidden="true" />
              </Link>
              <p className="text-sm">{MOTIVO[item.reason]}</p>
              <p className="text-sm text-ink-soft">
                {textoModalidade(item.state)} · {textoValidade(item, item.tenant.timezone)}
              </p>
            </li>
          ))}
        </ul>
      )}
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

      {estado.status !== "pronto" ? (
        <EstadoLeitura estado={estado} recarregar={recarregar} />
      ) : (
        <Conteudo visao={estado.dados} alcance={alcance} />
      )}
    </div>
  );
}

const horaBr = (instante: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(instante));

function Conteudo({ visao, alcance }: { visao: VisaoGeral; alcance: EscopoDoDiretorio }) {
  const e = visao.establishments;
  const rota = (filtro: { filtro?: string; situacao?: string }) => rotaEstabelecimentosFiltrados({ ...filtro, alcance });
  // API anterior (sem `scope`): "cadastrados", sem afirmar que são clientes.
  const confirmado = alcanceConfirmado(alcance, visao.scope);
  const rotuloTotal =
    confirmado === "CLIENTS" ? "Clientes" : confirmado === "INTERNAL" ? "Internos/teste" : "Estabelecimentos cadastrados";
  return (
    <>
      <section aria-label="Estabelecimentos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Indicador href={rota({})} icone={Building2} rotulo={rotuloTotal} valor={e.total} testId="indicador-total" />
        <Indicador
          href={rota({ filtro: "ACCESS_ALLOWED" })}
          icone={CircleCheck}
          rotulo="Com acesso liberado"
          valor={e.allowed}
          detalhe="Em operação e com validade em vigor, inclusive em teste gratuito."
          testId="indicador-liberados"
        />
        <Indicador
          href={rota({ filtro: "ACCESS_BLOCKED" })}
          icone={Ban}
          rotulo="Com acesso bloqueado"
          valor={e.blocked}
          detalhe={`${e.blockedByStatus} pela situação (suspenso, arquivado ou cancelado) · ${e.blockedByValidity} pela validade`}
          testId="indicador-bloqueados"
        />
        <Indicador
          href={rota({ filtro: "EXPIRING_SOON" })}
          icone={CalendarClock}
          rotulo="Testes e validades que terminam em até 7 dias"
          valor={e.expiringSoon}
          detalhe="Último dia coberto entre hoje e os próximos 6 dias, já contando as renovações registradas."
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
          rotulo="Condição contratada pendente"
          valor={e.contractPending}
          detalhe="Sem valor contratado específico no plano atual."
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
