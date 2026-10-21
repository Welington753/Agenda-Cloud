"use client";

// Solicitações da área REAL: ligar o agendamento online, copiar o link
// público e responder às reservas aguardando confirmação.
//
// A LISTA vem do banco (GET /tenants/:id/booking-requests): continua igual
// depois de recarregar, e só muda quando a pessoa CONFIRMA ou RECUSA. Abrir a
// tela, ver o contador ou abrir o WhatsApp não aprova nada.
//
// CONFIRMAR e RECUSAR usam as ações reais da agenda (`confirm` e `cancel`),
// com `expectedStartAt` = o horário que o cartão MOSTRA. Se a reserva mudou
// depois de a tela carregar, o servidor recusa (409), a lista é relida e
// nada é reenviado sozinho. Falha de comunicação nunca afirma que nada
// aconteceu.
//
// "Combinar outro horário" é só um link para o WhatsApp (contato-whatsapp):
// não remarca nem confirma. É contato MANUAL: nenhum envio automático.
//
// A lista se atualiza sozinha (SolicitacoesProvider, no layout de /conta),
// e uma solicitação aberta por "Ver solicitação" num aviso chega aqui com o
// cartão em destaque — só destacado, nunca confirmado.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, Check, Inbox, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import type { SolicitacaoPendente } from "@/lib/api/booking-requests-api";
import { alterarStatusAgendamento } from "@/lib/api/appointment-status-api";
import { cancelarAgendamento } from "@/lib/api/appointments-api";
import { mensagemFalhaStatus } from "@/lib/profissionais/andamento";
import { mensagemFalhaCancelamento } from "@/lib/profissionais/agendamentos";
import { dataLocalDoInstante } from "@/lib/agendamento-publico/solicitacoes";
import { dataBr } from "@/lib/agendamento-publico/agendamento-publico";
import {
  useAvisosDeSolicitacoes,
  useSolicitacoesPendentes,
} from "@/lib/agendamento-publico/use-solicitacoes";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { ContatoDaReserva } from "@/components/conta/contato-whatsapp";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { AgendamentoOnline, mensagemFalhaPrivada } from "./agendamento-online";
import { PreferenciasDeAviso } from "./preferencias-de-aviso";

export default function SolicitacoesPage() {
  const { estado: estadoSessao } = useRealAuth();
  const router = useRouter();
  const sessao = estadoSessao.status === "autenticado" ? estadoSessao.sessao : null;
  const tenantId = estadoSessao.status === "autenticado" ? estadoSessao.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantId;

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  const { estado, recarregar } = useSolicitacoesPendentes();
  const { destaque, limparDestaque } = useAvisosDeSolicitacoes();
  const carregada = estado.status === "carregada";

  // "Ver solicitação" (aviso de nova solicitação): leva o foco ao cartão.
  // Só rola e destaca; nenhuma ação é feita.
  useEffect(() => {
    if (!destaque || !carregada) return;
    const cartao = document.getElementById(`solicitacao-${destaque}`);
    if (!cartao) return;
    cartao.scrollIntoView({ block: "center" });
    cartao.focus({ preventScroll: true });
  }, [destaque, carregada]);
  useEffect(() => limparDestaque, [limparDestaque]);

  if (!sessao || !tenantId) return null;
  const contexto = encontrarContextoPorTenantId(sessao, tenantId);

  return (
    <PaginaConta
      titulo="Solicitações"
      descricao="Pedidos do agendamento online e reservas aguardando sua confirmação."
      acoes={
        <Botao variante="secundaria" onClick={recarregar} data-testid="recarregar-solicitacoes">
          <RefreshCw size={16} aria-hidden="true" /> Atualizar
        </Botao>
      }
    >
      <AgendamentoOnline tenantId={tenantId} />
      <PreferenciasDeAviso />

      <section className="space-y-3" aria-labelledby="titulo-pendentes">
        <h2 id="titulo-pendentes" className="text-lg font-semibold text-ink">
          Aguardando confirmação
        </h2>
        {estado.status === "carregando" && <Skeleton className="h-28 w-full" />}
        {estado.status === "falha" && (
          <Cartao data-testid="solicitacoes-falha">
            <CartaoCorpo className="flex items-start gap-3">
              <ShieldAlert size={20} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden="true" />
              <p role="alert" className="text-sm text-ink">
                {mensagemFalhaPrivada(estado.falha)}
              </p>
            </CartaoCorpo>
          </Cartao>
        )}
        {estado.status === "carregada" && estado.lista.solicitacoes.length === 0 && (
          <Cartao data-testid="sem-solicitacoes">
            <CartaoCorpo className="flex items-start gap-3">
              <Inbox size={20} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden="true" />
              <p className="text-sm text-ink-soft">Nenhuma solicitação aguardando confirmação.</p>
            </CartaoCorpo>
          </Cartao>
        )}
        {estado.status === "carregada" && estado.desatualizada && (
          <p role="status" className="text-sm text-ink-soft" data-testid="solicitacoes-desatualizadas">
            Não foi possível atualizar agora. Mostrando a última lista recebida; uma nova tentativa é
            feita automaticamente.
          </p>
        )}
        {estado.status === "carregada" && estado.lista.solicitacoes.length > 0 && (
          <ul className="space-y-3" data-testid="lista-solicitacoes">
            {estado.lista.solicitacoes.map((s) => (
              <li key={s.id}>
                <CartaoSolicitacao
                  tenantId={tenantId}
                  solicitacao={s}
                  estabelecimento={contexto?.tenantName ?? ""}
                  destacada={destaque === s.id}
                  aoMudar={recarregar}
                />
              </li>
            ))}
          </ul>
        )}
        {estado.status === "carregada" && !estado.lista.completa && (
          <p className="text-xs text-ink-soft">
            Mostrando as primeiras solicitações. Responda a estas para ver as demais.
          </p>
        )}
      </section>
    </PaginaConta>
  );
}

function CartaoSolicitacao({
  tenantId,
  solicitacao: s,
  estabelecimento,
  destacada,
  aoMudar,
}: {
  tenantId: string;
  solicitacao: SolicitacaoPendente;
  estabelecimento: string;
  destacada: boolean;
  aoMudar: () => void;
}) {
  const { notificar } = useToast();
  const [gravando, setGravando] = useState<"confirmar" | "recusar" | null>(null);
  const [confirmandoRecusa, setConfirmandoRecusa] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    if (gravando) return;
    setGravando("confirmar");
    setErro(null);
    const r = await alterarStatusAgendamento(tenantId, s.id, "confirm", { expectedStartAt: s.startAt });
    setGravando(null);
    if (r.ok) {
      notificar("Solicitação confirmada.", "sucesso");
      aoMudar();
      return;
    }
    setErro(mensagemFalhaStatus("confirm", r.falha));
    if (r.falha.tipo === "horario_ocupado" || r.falha.tipo === "nao_agendavel") aoMudar();
  }

  async function recusar() {
    if (gravando) return;
    setGravando("recusar");
    setErro(null);
    const r = await cancelarAgendamento(tenantId, s.id, { expectedStartAt: s.startAt });
    setGravando(null);
    setConfirmandoRecusa(false);
    if (r.ok) {
      notificar("Solicitação recusada. O horário voltou a ficar livre.", "sucesso");
      aoMudar();
      return;
    }
    setErro(mensagemFalhaCancelamento(r.falha));
    if (r.falha.tipo === "horario_ocupado" || r.falha.tipo === "nao_agendavel") aoMudar();
  }

  const data = dataLocalDoInstante(s.startAt, s.timezone);

  return (
    <Cartao
      id={`solicitacao-${s.id}`}
      tabIndex={-1}
      data-testid="solicitacao"
      data-appointment-id={s.id}
      data-destacada={destacada ? "true" : undefined}
      className={clsx("scroll-mt-24 focus:outline-none", destacada && "ring-2 ring-[var(--color-accent)]")}
    >
      <CartaoCorpo className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink" data-testid="solicitacao-horario">
              {data ? dataBr(data) : ""} às {s.localStart}
            </p>
            <p className="text-sm text-ink">
              {s.service.name} · {s.professional.name}
            </p>
            <p className="text-sm text-ink-soft" data-testid="solicitacao-cliente">
              {s.consumer.name} · {s.consumer.whatsapp}
            </p>
          </div>
          <span
            data-testid="solicitacao-origem"
            className="rounded-full bg-paper-muted px-2.5 py-1 text-xs font-medium text-ink"
          >
            {s.origin === "PUBLIC" ? "Pedido online" : "Criada na agenda"}
          </span>
        </div>

        {erro && (
          <p role="alert" data-testid="solicitacao-erro" className="flex items-start gap-2 text-sm text-ink">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {erro}
          </p>
        )}

        {confirmandoRecusa ? (
          <div className="space-y-2 rounded-[var(--radius-control)] border border-border p-3" data-testid="confirmar-recusa">
            <p className="text-sm text-ink">
              Recusar o pedido de {s.consumer.name} para {data ? dataBr(data) : ""} às {s.localStart}? O horário
              volta a ficar livre. Avise o cliente pelo WhatsApp, se quiser.
            </p>
            <div className="flex flex-wrap gap-2">
              <Botao variante="secundaria" onClick={() => void recusar()} disabled={!!gravando} data-testid="confirmar-recusa-botao">
                {gravando === "recusar" ? "Recusando..." : "Sim, recusar"}
              </Botao>
              <Botao variante="secundaria" onClick={() => setConfirmandoRecusa(false)} disabled={!!gravando}>
                Manter pedido
              </Botao>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Botao onClick={() => void confirmar()} disabled={!!gravando} data-testid="confirmar-solicitacao">
              <Check size={16} aria-hidden="true" />
              {gravando === "confirmar" ? "Confirmando..." : "Confirmar"}
            </Botao>
            <Botao
              variante="secundaria"
              onClick={() => setConfirmandoRecusa(true)}
              disabled={!!gravando}
              data-testid="recusar-solicitacao"
            >
              <X size={16} aria-hidden="true" /> Recusar
            </Botao>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs text-ink-soft" data-testid="contato-manual">
            Contato manual pelo WhatsApp: abre a conversa para você escrever. Nenhuma mensagem é
            enviada automaticamente.
          </p>
          <ContatoDaReserva agendamento={s} estabelecimento={estabelecimento} />
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
