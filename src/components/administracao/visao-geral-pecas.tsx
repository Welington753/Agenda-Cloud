// Peças da Visão geral do portal (src/app/portal/(area)/visao-geral), usadas
// pelo arranjo de sempre e pelo do tema "Azul e branco"
// (visao-geral-azul.tsx). Só desenham o que vem de `GET /platform/overview`;
// textos, links e `data-testid` são os mesmos nos dois arranjos.
import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, ArrowUpRight, CalendarClock, ChevronRight, CircleAlert, type LucideIcon } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import type { EscopoDoDiretorio, MotivoDeAtencao, VisaoGeral } from "@/lib/administracao/contratos-diretorio";
import type { EstadoComercial } from "@/lib/administracao/contratos-validade";
import { alcanceConfirmado, textoMes, textoModalidade, textoValidade } from "@/lib/administracao/diretorio";
import { diaBr, reais } from "@/lib/administracao/validade";
import { rotaFichaEstabelecimento, rotaPagamentosFiltrados, rotaRelatorio } from "@/lib/administracao/rotas";

export const MOTIVO: Record<MotivoDeAtencao, string> = {
  VALIDITY_BLOCKED: "Em operação, mas sem acesso: validade vencida ou ausente",
  EXPIRING_SOON: "Validade termina em até 7 dias",
};

export const MODALIDADES: readonly EstadoComercial[] = ["TRIAL", "PAID", "COURTESY", "NO_EXPIRY", "UNTRACKED", "MISSING", "EXPIRED"];

export function Indicador({
  href,
  icone: Icone,
  rotulo,
  valor,
  detalhe,
  testId,
  azul = false,
  destaque = false,
}: {
  href: string;
  icone: LucideIcon;
  rotulo: string;
  valor: number;
  detalhe?: string;
  testId: string;
  /** Forma do tema "Azul e branco": número grande em azul. */
  azul?: boolean;
  /** Só no azul: fundo azul-claro no indicador principal. */
  destaque?: boolean;
}) {
  if (azul)
    return (
      <Link
        href={href}
        data-testid={testId}
        className={clsx(
          "group flex h-full items-start gap-4 rounded-[var(--radius-card)] border p-5 shadow-[var(--shadow-soft)] transition-colors",
          "hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          destaque ? "border-accent-soft bg-accent-soft" : "border-border bg-card",
        )}
      >
        <div
          className={clsx(
            "flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-accent",
            destaque ? "bg-card" : "bg-accent-soft",
          )}
        >
          <Icone size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{rotulo}</p>
          <p className="mt-1 text-4xl leading-none font-bold tracking-tight text-accent tabular-nums" data-testid={`${testId}-valor`}>
            {valor}
          </p>
          {detalhe && <p className="mt-2 text-xs text-ink-soft">{detalhe}</p>}
        </div>
        <ArrowUpRight size={16} aria-hidden="true" className="shrink-0 text-ink-soft group-hover:text-accent" />
      </Link>
    );
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

/** Textos dos pagamentos do mês, iguais nos dois arranjos. */
export function TextosDosPagamentos({ pagamentos }: { pagamentos: VisaoGeral["payments"] }) {
  return (
    <>
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
    </>
  );
}

export function QuantidadeDePagamentos({ pagamentos }: { pagamentos: VisaoGeral["payments"] }) {
  return (
    <>
      <p className="text-sm text-ink-soft" data-testid="pagamentos-do-mes-quantidade">
        {pagamentos.count === 0
          ? "Nenhum pagamento confirmado no período."
          : `${pagamentos.count} pagamento(s) confirmado(s) manualmente.`}
      </p>
      {pagamentos.canceledCount > 0 && (
        <p className="text-xs text-ink-soft" data-testid="pagamentos-anulados">
          {pagamentos.canceledCount} registro(s) anulado(s) por correção no período não entram na soma. Anular corrige o
          registro; não é estorno bancário.
        </p>
      )}
    </>
  );
}

export function LinksDosPagamentos({
  pagamentos,
  alcance,
  comSeta = false,
}: {
  pagamentos: VisaoGeral["payments"];
  alcance: EscopoDoDiretorio;
  comSeta?: boolean;
}) {
  const classe = "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent hover:underline";
  return (
    <>
      <Link
        href={rotaPagamentosFiltrados({ de: pagamentos.from, ate: pagamentos.to, alcance, situacao: "recebidos" })}
        className={classe}
        data-testid="link-pagamentos-do-mes"
      >
        Ver pagamentos
        {comSeta && <ArrowRight size={16} aria-hidden="true" />}
      </Link>
      <Link href={rotaRelatorio({ alcance })} className={classe} data-testid="link-outros-meses">
        Ver outros meses
      </Link>
    </>
  );
}

export function Pagamentos({
  pagamentos,
  alcance,
  azul = false,
}: {
  pagamentos: VisaoGeral["payments"];
  alcance: EscopoDoDiretorio;
  azul?: boolean;
}) {
  if (azul)
    return (
      <Cartao>
        <CartaoCorpo className="space-y-2" data-testid="pagamentos-do-mes">
          <div>
            <h2 className="text-lg font-semibold">Pagamentos de assinaturas</h2>
            <p className="text-sm text-ink-soft first-letter:uppercase">{textoMes(pagamentos.month)}</p>
          </div>
          <p className="pt-1 text-4xl font-bold tracking-tight text-accent tabular-nums" data-testid="pagamentos-do-mes-total">
            {reais(pagamentos.totalCents)}
          </p>
          <QuantidadeDePagamentos pagamentos={pagamentos} />
          <div className="flex flex-wrap gap-x-6 border-t border-border pt-1">
            <LinksDosPagamentos pagamentos={pagamentos} alcance={alcance} comSeta />
          </div>
          <details className="group">
            <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-[var(--radius-control)] text-xs font-medium text-ink-soft hover:text-ink">
              <ChevronRight size={14} aria-hidden="true" className="transition-transform group-open:rotate-90" />
              Como este valor é calculado
            </summary>
            <div className="space-y-2 pb-1">
              <TextosDosPagamentos pagamentos={pagamentos} />
            </div>
          </details>
        </CartaoCorpo>
      </Cartao>
    );
  return (
    <Cartao>
      <CartaoCorpo className="space-y-3" data-testid="pagamentos-do-mes">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-semibold">Pagamentos de assinaturas em {textoMes(pagamentos.month)}</h2>
          <div className="flex flex-wrap gap-x-4">
            <LinksDosPagamentos pagamentos={pagamentos} alcance={alcance} />
          </div>
        </div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums" data-testid="pagamentos-do-mes-total">
          {reais(pagamentos.totalCents)}
        </p>
        <QuantidadeDePagamentos pagamentos={pagamentos} />
        <TextosDosPagamentos pagamentos={pagamentos} />
      </CartaoCorpo>
    </Cartao>
  );
}

/** Estabelecimentos que precisam de atenção (só os em operação), iguais nos
 * dois arranjos; no azul, numa lista única dentro de um cartão. */
export function ItensDeAtencao({ visao, azul }: { visao: VisaoGeral; azul: boolean }) {
  const { attention } = visao;
  if (attention.items.length === 0)
    return (
      <p
        className={clsx("p-6 text-center text-ink-soft", !azul && "rounded-xl border border-border bg-card")}
        data-testid="atencao-vazia"
      >
        Nenhum estabelecimento em operação está com a validade vencida, ausente ou terminando nos próximos 7 dias.
      </p>
    );
  return (
    <ul className={azul ? "divide-y divide-border" : "space-y-2"} data-testid="lista-atencao">
      {attention.items.map((item) => {
        const IconeMotivo = item.reason === "VALIDITY_BLOCKED" ? CircleAlert : CalendarClock;
        return (
          <li
            key={item.tenant.id}
            className={azul ? "flex items-start gap-3 py-3 first:pt-0 last:pb-0" : "rounded-xl border border-border bg-card p-4"}
          >
            {azul && (
              <IconeMotivo
                size={18}
                aria-hidden="true"
                className={clsx(
                  "mt-3 shrink-0",
                  item.reason === "VALIDITY_BLOCKED" ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-warning)]",
                )}
              />
            )}
            <div className="min-w-0 flex-1">
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
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export const horaBr = (instante: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(instante));

/** Rótulo do total: API anterior (sem `scope`) fica em "cadastrados", sem
 * afirmar que são clientes. */
export function rotuloDoTotal(alcance: EscopoDoDiretorio, visao: VisaoGeral): string {
  const confirmado = alcanceConfirmado(alcance, visao.scope);
  return confirmado === "CLIENTS" ? "Clientes" : confirmado === "INTERNAL" ? "Internos/teste" : "Estabelecimentos cadastrados";
}

export const DETALHE_LIBERADOS = "Em operação e com validade em vigor, inclusive em teste gratuito.";
export const detalheBloqueados = (e: VisaoGeral["establishments"]) =>
  `${e.blockedByStatus} pela situação (suspenso, arquivado ou cancelado) · ${e.blockedByValidity} pela validade`;
export const ROTULO_VENCENDO = "Testes e validades que terminam em até 7 dias";
export const DETALHE_VENCENDO = "Último dia coberto entre hoje e os próximos 6 dias, já contando as renovações registradas.";
export const ROTULO_CONTRATO = "Condição contratada pendente";
export const DETALHE_CONTRATO = "Sem valor contratado específico no plano atual.";
