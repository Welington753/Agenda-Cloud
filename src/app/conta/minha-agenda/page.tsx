"use client";

// Agenda do FUNCIONÁRIO: só os atendimentos do profissional ligado ao acesso
// desta conta no estabelecimento ativo (GET /tenants/:id/my-agenda). O
// profissional nunca vai na URL: o servidor descobre pelo vínculo da sessão.
//
// Mostra data, horário, cliente, serviço e situação. Os botões de cada
// reserva são os que o servidor devolveu em `actions` (permissão liberada
// pelo dono + regra de horário e estado); o servidor confere tudo de novo ao
// executar. Permissão retirada, acesso suspenso ou profissional desativado
// aparecem na leitura seguinte.
//
// Trocar de estabelecimento muda o endereço lido: a resposta anterior nunca
// aparece para o novo (ver use-leitura-plataforma.ts).
//
// "Calendário" mostra mês, semana ou dia só com os atendimentos desta conta
// (GET /tenants/:id/my-agenda/range); tocar num atendimento abre o dia dele,
// com os botões liberados.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CalendarRange, CalendarX2, ChevronLeft, ChevronRight, List, RefreshCw } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import { useDiaDoEstabelecimento } from "@/lib/profissionais/use-dia-do-estabelecimento";
import { deslocarData } from "@/lib/profissionais/agenda-visual";
import { rotuloDaData } from "@/lib/profissionais/agendamentos";
import {
  ROTULO_ACAO,
  ehAtendimentoAlterado,
  ehMinhaAgenda,
  perguntaDaAcao,
  type AcaoDoFuncionario,
  type AtendimentoProprio,
} from "@/lib/equipe/contratos";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { LinkDeAgendamento } from "@/components/conta/link-de-agendamento";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { StatusDoAtendimento } from "@/components/conta/cartao-atendimento";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { CalendarioDoFuncionario } from "./calendario-do-funcionario";

const CAMPO = "min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3 py-2 text-sm text-ink";

const MENSAGEM_DE_LEITURA = {
  sessao: "Sua sessão precisa ser verificada novamente. Entre de novo.",
  permissao:
    "Seu acesso a esta agenda não está disponível agora. Ele pode ter sido suspenso ou o seu cadastro de profissional pode ter sido desativado. Fale com o responsável pelo estabelecimento.",
  ausente: "Você não tem mais acesso a este estabelecimento.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar sua agenda.",
} as const;

export default function MinhaAgendaPage() {
  const { estado: sessao } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const slug = sessao.status === "autenticado" && tenantId ? encontrarContextoPorTenantId(sessao.sessao, tenantId)?.tenantSlug : null;
  const precisaSelecionar =
    sessao.status === "autenticado" && sessao.sessao.requiresTenantSelection && !tenantId;
  const dia = useDiaDoEstabelecimento(tenantId);
  const caminho = tenantId
    ? `/tenants/${encodeURIComponent(tenantId)}/my-agenda?date=${encodeURIComponent(dia.date)}`
    : null;
  const [modo, setModo] = useState<"dia" | "calendario">("dia");
  const [destacadaId, setDestacadaId] = useState<string | null>(null);
  // Só um modo é lido de cada vez: no Calendário, a leitura do dia para.
  const { estado, recarregar } = useLeituraPlataforma(modo === "dia" ? caminho : null, ehMinhaAgenda);
  const [pedido, setPedido] = useState<{ acao: AcaoDoFuncionario; atendimento: AtendimentoProprio } | null>(null);
  const [executando, setExecutando] = useState(false);

  const { sincronizar } = dia;
  const agenda = estado.status === "pronto" ? estado.dados : null;
  useEffect(() => {
    if (agenda) sincronizar(agenda);
  }, [agenda, sincronizar]);

  // Trocar de estabelecimento fecha a confirmação aberta do anterior.
  useEffect(() => {
    setPedido(null);
    setDestacadaId(null);
  }, [tenantId]);

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  if (sessao.status !== "autenticado" || precisaSelecionar) return null;
  // Sem estabelecimento ativo: o acesso foi suspenso ou removido (ele some da
  // sessão), ou a conta nunca teve um.
  if (!tenantId) {
    return (
      <PaginaConta titulo="Minha agenda">
        <Cartao>
          <CartaoCorpo>
            <p role="alert" className="text-sm text-ink">
              Sua conta não tem acesso ativo a um estabelecimento agora. Se você trabalha em um, fale com o
              responsável.
            </p>
          </CartaoCorpo>
        </Cartao>
      </PaginaConta>
    );
  }

  async function executar() {
    if (!pedido || !tenantId || executando) return;
    setExecutando(true);
    const { acao, atendimento } = pedido;
    const resultado = await acaoAdministrativa<unknown>(
      `/tenants/${encodeURIComponent(tenantId)}/my-agenda/${encodeURIComponent(atendimento.id)}/${acao}`,
      "POST",
      { expectedStartAt: atendimento.startAt },
    );
    setExecutando(false);
    setPedido(null);
    if (resultado.tipo === "ok" && ehAtendimentoAlterado(resultado.dados)) {
      notificar(`${ROTULO_ACAO[acao]}: feito.`, "sucesso");
    } else if (resultado.tipo === "ok") {
      notificar("O servidor respondeu de um jeito inesperado. Confira a agenda.", "info");
    } else {
      notificar(mensagemDoResultado(resultado), "info");
    }
    // Sempre relê: a tela mostra o estado que o servidor gravou (ou recusou).
    recarregar();
  }

  return (
    <PaginaConta
      titulo="Minha agenda"
      descricao={agenda ? `Atendimentos de ${agenda.professional.name}` : "Seus atendimentos neste estabelecimento."}
    >
      <div
        role="group"
        aria-label="Visualização da agenda"
        className="inline-flex w-full rounded-[var(--radius-control)] border border-border bg-card p-1 sm:w-auto"
      >
        {(
          [
            { valor: "dia", rotulo: "Dia", icone: List },
            { valor: "calendario", rotulo: "Calendário", icone: CalendarRange },
          ] as const
        ).map(({ valor, rotulo, icone: Icone }) => (
          <button
            key={valor}
            type="button"
            aria-pressed={modo === valor}
            onClick={() => setModo(valor)}
            className={clsx(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-4 text-sm font-medium sm:flex-none",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              modo === valor ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-muted hover:text-ink",
            )}
          >
            <Icone size={16} aria-hidden="true" />
            {rotulo}
          </button>
        ))}
      </div>

      {modo === "calendario" && (
        <CalendarioDoFuncionario
          key={tenantId}
          tenantId={tenantId}
          dataInicial={dia.date}
          timezone={dia.timezone}
          mensagemDeLeitura={MENSAGEM_DE_LEITURA}
          aoAbrir={(item) => {
            setDestacadaId(item.id);
            dia.mudarData(item.localDate);
            setModo("dia");
          }}
        />
      )}

      {modo === "dia" && (
        <>
          <div className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Dia</p>
                <h2 data-testid="data-da-minha-agenda" className="text-lg font-bold text-ink first-letter:uppercase">
                  {rotuloDaData(dia.date)}
                </h2>
                {dia.timezone && <p className="text-xs text-ink-soft">fuso {dia.timezone}</p>}
              </div>
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:flex">
                <Botao
                  type="button"
                  variante="secundaria"
                  aria-label="Dia anterior"
                  className="min-h-11"
                  onClick={() => dia.mudarData(deslocarData(dia.date, -1))}
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </Botao>
                <Botao type="button" variante="secundaria" className="min-h-11" onClick={dia.irParaHoje}>
                  Hoje
                </Botao>
                <Botao
                  type="button"
                  variante="secundaria"
                  aria-label="Próximo dia"
                  className="min-h-11"
                  onClick={() => dia.mudarData(deslocarData(dia.date, 1))}
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </Botao>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="block min-w-0 flex-1 text-sm font-medium text-ink">
                Ir para o dia
                <input
                  type="date"
                  className={`mt-1 ${CAMPO}`}
                  value={dia.date}
                  onChange={(e) => e.target.value && dia.mudarData(e.target.value)}
                />
              </label>
              <Botao type="button" variante="secundaria" className="min-h-11" onClick={recarregar}>
                <RefreshCw size={16} aria-hidden="true" />
                Atualizar
              </Botao>
            </div>
          </div>

          {estado.status === "carregando" && (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {estado.status === "erro" && (
            <Cartao>
              <CartaoCorpo className="space-y-3">
                <p role="alert" className="text-sm text-ink">
                  {MENSAGEM_DE_LEITURA[estado.motivo]}
                </p>
                {(estado.motivo === "rede" || estado.motivo === "servidor") && (
                  <Botao type="button" onClick={recarregar}>
                    Tentar novamente
                  </Botao>
                )}
              </CartaoCorpo>
            </Cartao>
          )}

          {agenda && (
            <>
              {agenda.appointments.length === 0 ? (
                <EstadoVazio
                  icone={CalendarX2}
                  titulo="Nenhum atendimento seu neste dia"
                  descricao="Quando houver reservas com você, elas aparecem aqui."
                />
              ) : (
                <ul className="space-y-3" data-testid="minha-agenda">
                  {agenda.appointments.map((a) => (
                    <li
                      key={a.id}
                      className={clsx(
                        "rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-[var(--shadow-soft)]",
                        a.id === destacadaId && "ring-2 ring-[color:var(--color-accent)]",
                      )}
                      data-testid="atendimento-proprio"
                      data-destacada={a.id === destacadaId || undefined}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-base font-semibold text-ink">
                            {a.localStart}–{a.localServiceEnd}
                          </p>
                          <p className="mt-1 break-words text-sm text-ink">{a.consumer.name}</p>
                          <p className="break-words text-sm text-ink-soft">{a.service.name}</p>
                        </div>
                        <StatusDoAtendimento status={a.status} />
                      </div>
                      {a.actions.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {a.actions.map((acao) => (
                            <Botao
                              key={acao}
                              type="button"
                              variante={acao === "no-show" ? "secundaria" : "primaria"}
                              className="min-h-11"
                              onClick={() => setPedido({ acao, atendimento: a })}
                            >
                              {ROTULO_ACAO[acao]}
                            </Botao>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!agenda.complete && (
                <p className="text-xs text-ink-soft">A lista deste dia chegou ao limite e pode estar incompleta.</p>
              )}
              <Cartao>
                <CartaoCorpo className="space-y-1 text-sm">
                  <p className="font-semibold text-ink">O que você pode fazer aqui</p>
                  <ul className="list-disc space-y-1 pl-5 text-ink-soft" data-testid="minhas-permissoes">
                    <li>Ver os seus atendimentos.</li>
                    {agenda.permissions.start && <li>Iniciar os seus atendimentos.</li>}
                    {agenda.permissions.complete && <li>Concluir os seus atendimentos.</li>}
                    {agenda.permissions["no-show"] && <li>Marcar falta nos seus atendimentos.</li>}
                  </ul>
                  <p className="text-xs text-ink-soft">
                    Criar, confirmar, remarcar e cancelar reservas pelo painel depende do que o responsável liberar.
                    Compartilhar o link de agendamento não muda isso.
                  </p>
                </CartaoCorpo>
              </Cartao>
              {slug && <LinkDeAgendamento slug={slug} />}
            </>
          )}
        </>
      )}

      <Modal aberto={!!pedido} aoFechar={() => !executando && setPedido(null)} titulo={pedido ? ROTULO_ACAO[pedido.acao] : ""}>
        {pedido && (
          <div className="space-y-4">
            <p>{perguntaDaAcao(pedido.acao, pedido.atendimento)}</p>
            <div className="flex justify-end gap-2">
              <Botao type="button" variante="secundaria" className="min-h-11" disabled={executando} onClick={() => setPedido(null)}>
                Voltar
              </Botao>
              <Botao type="button" className="min-h-11" disabled={executando} onClick={() => void executar()}>
                {executando ? "Enviando…" : "Confirmar"}
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </PaginaConta>
  );
}
