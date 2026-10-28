"use client";

// Início do dono: o que importa para o dia e para o período, com dados reais
// do estabelecimento ativo.
//
// DE ONDE VÊM OS NÚMEROS: todos de GET /tenants/:id/dashboard, contados no
// SERVIDOR sobre o período inteiro (nunca sobre uma página de lista), no fuso
// do estabelecimento. A tela não soma nada sozinha. Cada bloco diz de que
// período é; "Como os números são calculados" explica cada um.
//
// QUANDO NÃO HÁ NÚMERO: carregando, falha de comunicação ou sem permissão —
// cada um com o seu estado. Zero só aparece quando o servidor respondeu zero.
//
// Dinheiro: só os recebimentos registrados à mão (Recebimentos), contados
// pelo servidor. Preço de reserva nunca vira dinheiro recebido.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarPlus, ShieldAlert, Store } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { rotuloDaData } from "@/lib/profissionais/agendamentos";
import type { FalhaPainel } from "@/lib/api/dashboard-api";
import {
  erroDoPeriodo,
  periodoDaEscolha,
  rotuloDoPeriodo,
  type EscolhaDePeriodo,
  type PeriodoLocal,
} from "@/lib/conta/inicio";
import { usePainel } from "@/lib/conta/use-painel";
import { ROTA_AGENDA } from "@/lib/conta/rotas";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoSolicitacoes } from "@/components/conta/aviso-solicitacoes";
import { Botao, LinkBotao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { LinkAdministracao } from "@/components/administracao/acesso-administracao";
import { Carregando, ComoCalculamos, Financeiro, Hoje, Periodo, Plano, Proximos } from "./blocos";

const ESCOLHAS: { valor: EscolhaDePeriodo; rotulo: string }[] = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "mes", rotulo: "Este mês" },
  { valor: "personalizado", rotulo: "Personalizado" },
];

function mensagemDaFalha(falha: FalhaPainel): string {
  switch (falha.tipo) {
    case "nao_autenticado":
      return "Sua sessão expirou. Entre novamente para continuar.";
    case "periodo_invalido":
      return falha.mensagem ?? "Período inválido. Revise as datas.";
    case "falha_comunicacao":
      return "Não foi possível carregar os indicadores. Verifique a conexão e tente de novo.";
    default:
      return "Não foi possível carregar os indicadores agora. Tente novamente em instantes.";
  }
}

export default function InicioPage() {
  const { estado: estadoSessao } = useRealAuth();
  const router = useRouter();
  const sessao = estadoSessao.status === "autenticado" ? estadoSessao.sessao : null;
  const tenantIdAtivo = estadoSessao.status === "autenticado" ? estadoSessao.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  const [escolha, setEscolha] = useState<EscolhaDePeriodo>("mes");
  const [rascunho, setRascunho] = useState<PeriodoLocal>({ from: "", to: "" });
  const [personalizado, setPersonalizado] = useState<PeriodoLocal | null>(null);
  const [hojeConhecido, setHojeConhecido] = useState<string | null>(null);

  // "Este mês" deixa o servidor escolher o mês no fuso do estabelecimento;
  // "Hoje" usa o hoje que o servidor informou; "Personalizado", as datas
  // aplicadas.
  const periodoPedido =
    escolha === "mes"
      ? null
      : escolha === "hoje"
        ? hojeConhecido
          ? periodoDaEscolha("hoje", hojeConhecido, rascunho)
          : null
        : personalizado;
  const { estado, recarregar } = usePainel(tenantIdAtivo, periodoPedido);
  const painel = estado.status === "pronto" ? estado.painel : estado.status === "carregando" ? estado.anterior : null;

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  useEffect(() => {
    if (estado.status === "pronto") setHojeConhecido(estado.painel.today);
  }, [estado]);

  // Trocar de estabelecimento volta ao mês corrente.
  useEffect(() => {
    setEscolha("mes");
    setPersonalizado(null);
    setHojeConhecido(null);
  }, [tenantIdAtivo]);

  if (!sessao || precisaSelecionar) return null;
  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  if (!contexto) {
    return (
      <PaginaConta titulo="Início">
        <Cartao>
          <CartaoCorpo className="flex items-start gap-3">
            <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
            <p className="text-sm text-ink-soft">Sua conta ainda não está vinculada a um estabelecimento.</p>
          </CartaoCorpo>
        </Cartao>
        <LinkAdministracao />
      </PaginaConta>
    );
  }

  const erroPersonalizado = escolha === "personalizado" ? erroDoPeriodo(rascunho) : null;

  return (
    <PaginaConta
      titulo="Início"
      descricao={
        painel ? (
          <>
            Hoje é <span data-testid="inicio-hoje">{rotuloDaData(painel.today)}</span> · fuso {painel.timezone}
          </>
        ) : (
          `Resumo de ${contexto.tenantName}`
        )
      }
      acoes={
        <>
          <LinkBotao href={ROTA_AGENDA} variante="secundaria" data-testid="atalho-agenda">
            <CalendarDays size={16} aria-hidden="true" />
            Abrir agenda
          </LinkBotao>
          <LinkBotao href={`${ROTA_AGENDA}?novo=1`} data-testid="atalho-novo-agendamento">
            <CalendarPlus size={16} aria-hidden="true" />
            Novo agendamento
          </LinkBotao>
        </>
      }
    >
      <AvisoSolicitacoes tenantId={contexto.tenantId} />

      {estado.status === "falha" &&
        (estado.falha.tipo === "sem_permissao" || estado.falha.tipo === "sem_acesso" ? (
          <Cartao data-testid="visao-geral-sem-permissao">
            <CartaoCorpo className="flex items-start gap-3">
              <ShieldAlert size={20} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden="true" />
              <p role="alert" className="text-sm text-ink">
                Você não tem permissão para ver a agenda deste estabelecimento, então os indicadores não
                podem ser mostrados.
              </p>
            </CartaoCorpo>
          </Cartao>
        ) : (
          <Cartao data-testid="visao-geral-erro">
            <CartaoCorpo className="space-y-3">
              <p role="alert" className="text-sm text-ink">
                {mensagemDaFalha(estado.falha)}
              </p>
              <Botao type="button" onClick={recarregar}>
                Tentar novamente
              </Botao>
            </CartaoCorpo>
          </Cartao>
        ))}

      {!painel && estado.status === "carregando" && <Carregando />}

      {painel && (
        <div className="space-y-8" aria-busy={estado.status === "carregando"}>
          <Hoje painel={painel} aoAtualizar={recarregar} atualizando={estado.status === "carregando"} />

          <section aria-labelledby="titulo-periodo" className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="titulo-periodo" className="text-base font-semibold text-ink">
                  Período
                </h2>
                <p className="text-sm text-ink-soft" data-testid="periodo-indicadores">
                  {rotuloDoPeriodo(painel.period)}
                </p>
              </div>
              <div
                role="group"
                aria-label="Período dos indicadores"
                className="inline-flex w-full rounded-[var(--radius-control)] border border-border bg-card p-1 sm:w-auto"
              >
                {ESCOLHAS.map(({ valor, rotulo }) => (
                  <button
                    key={valor}
                    type="button"
                    aria-pressed={escolha === valor}
                    onClick={() => setEscolha(valor)}
                    className={
                      escolha === valor
                        ? "min-h-11 flex-1 rounded-[calc(var(--radius-control)-2px)] px-3 text-sm bg-accent-soft font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-border-control)] sm:flex-none"
                        : "min-h-11 flex-1 rounded-[calc(var(--radius-control)-2px)] px-3 text-sm font-medium text-ink-soft hover:bg-paper-muted hover:text-ink sm:flex-none"
                    }
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>

            {escolha === "personalizado" && (
              <form
                className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 sm:flex-row sm:items-end"
                onSubmit={(evento) => {
                  evento.preventDefault();
                  if (!erroDoPeriodo(rascunho)) setPersonalizado({ ...rascunho });
                }}
              >
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-ink">
                  De
                  <input
                    type="date"
                    value={rascunho.from}
                    onChange={(e) => setRascunho((r) => ({ ...r, from: e.target.value }))}
                    className="min-h-11 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-ink"
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-ink">
                  Até
                  <input
                    type="date"
                    value={rascunho.to}
                    onChange={(e) => setRascunho((r) => ({ ...r, to: e.target.value }))}
                    className="min-h-11 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-ink"
                  />
                </label>
                <Botao type="submit" disabled={!!erroPersonalizado}>
                  Aplicar
                </Botao>
                {erroPersonalizado && rascunho.from && rascunho.to && (
                  <p role="alert" className="text-sm text-ink sm:basis-full">
                    {erroPersonalizado}
                  </p>
                )}
              </form>
            )}

            <Periodo painel={painel} />
            <Financeiro painel={painel} />
          </section>

          <Proximos painel={painel} />

          <Plano painel={painel} />

          <ComoCalculamos />
        </div>
      )}
    </PaginaConta>
  );
}
