"use client";

// Consulta autenticada de disponibilidade real (Lote 6D.4). Vive sob
// `/conta`, área REAL: nada de repositório, seed ou dado da demonstração
// entra aqui (auditado por lib/servicos/sem-dados-demo.test.ts).
//
// ESTA TELA NÃO RESERVA NADA. É uma consulta: mostra os horários livres
// naquele instante e diz isso explicitamente. Não existe botão de agendar,
// confirmar ou bloquear — o backend deste lote também não tem rota para isso.
//
// Fuso: os horários são exibidos na hora local do ESTABELECIMENTO, como o
// backend os devolve (`localStart`/`localEnd`). O relógio do navegador nunca
// converte nada — ele pode estar em outro fuso.
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarSearch, Clock, Info, Store } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { useProfissionaisReais } from "@/lib/profissionais/use-profissionais-reais";
import { useDisponibilidadeReal } from "@/lib/profissionais/use-disponibilidade-real";
import {
  dataInicial,
  marcarAmbiguos,
  mensagemFalhaDisponibilidade,
  mensagemSemHorario,
  regrasAplicadas,
  rotuloDaData,
} from "@/lib/profissionais/disponibilidade";
import type { DisponibilidadeReal } from "@/lib/api/availability-api";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DisponibilidadeDoProfissionalPage() {
  const { estado: estadoSessao } = useRealAuth();
  const router = useRouter();
  const params = useParams<{ professionalId: string }>();
  const professionalId = params.professionalId;

  const sessao = estadoSessao.status === "autenticado" ? estadoSessao.sessao : null;
  const tenantIdAtivo = estadoSessao.status === "autenticado" ? estadoSessao.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  const { estado: estadoProfissionais } = useProfissionaisReais(tenantIdAtivo);
  const { estado, consultar, limpar } = useDisponibilidadeReal(tenantIdAtivo, professionalId);

  const [serviceId, setServiceId] = useState("");
  // `useState` com inicializador de função: o "hoje" é lido UMA vez, na
  // montagem, e nunca a cada render.
  const [date, setDate] = useState(() => dataInicial(new Date()));

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  const profissional =
    estadoProfissionais.status === "carregada"
      ? estadoProfissionais.profissionais.find((p) => p.id === professionalId)
      : undefined;

  // Só os serviços que este profissional REALMENTE realiza e que continuam
  // ativos: oferecer os outros só produziria um 400 previsível do servidor.
  const servicosElegiveis = useMemo(
    () => (profissional?.services ?? []).filter((vinculo) => vinculo.serviceActive),
    [profissional],
  );

  // Pré-seleciona o primeiro elegível assim que a lista chega, sem nunca
  // sobrescrever uma escolha já feita pela pessoa.
  useEffect(() => {
    if (!serviceId && servicosElegiveis.length > 0) setServiceId(servicosElegiveis[0].serviceId);
  }, [serviceId, servicosElegiveis]);

  if (!sessao || precisaSelecionar) return null;

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  if (!contexto) {
    return (
      <Pagina titulo="Consultar disponibilidade">
        <Cartao>
          <CartaoCorpo className="flex items-start gap-3">
            <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
            <p className="text-sm text-ink-soft">
              Sua conta ainda não está vinculada a um estabelecimento.
            </p>
          </CartaoCorpo>
        </Cartao>
      </Pagina>
    );
  }

  const consultando = estado.status === "consultando";

  function aoConsultar(evento: React.FormEvent) {
    evento.preventDefault();
    // Segunda barreira contra envio duplicado, além do `disabled` do botão.
    if (consultando || !serviceId || !date) return;
    consultar({ serviceId, date });
  }

  /** Mudar a seleção invalida o que está na tela: o resultado visível passa a
   * não corresponder aos campos, e manter os dois juntos enganaria. */
  function aoMudarSelecao(aplicar: () => void) {
    aplicar();
    if (estado.status !== "ociosa") limpar();
  }

  return (
    <Pagina
      titulo="Consultar disponibilidade"
      subtitulo={
        profissional ? `${profissional.name} · ${contexto.tenantName}` : contexto.tenantName
      }
    >
      <Cartao>
        <CartaoCorpo className="flex items-start gap-3">
          <Info size={18} className="mt-0.5 shrink-0 text-ink-soft" />
          <p className="text-sm text-ink-soft">
            Esta consulta <strong className="font-semibold text-ink">não reserva horário</strong>. É
            uma fotografia da agenda agora: até a reserva ser criada, outro agendamento pode ocupar
            o mesmo horário.
          </p>
        </CartaoCorpo>
      </Cartao>

      {estadoProfissionais.status === "carregada" && !profissional && (
        <Cartao>
          <CartaoCorpo>
            <p role="alert" className="text-sm text-ink">
              Profissional não encontrado neste estabelecimento.
            </p>
          </CartaoCorpo>
        </Cartao>
      )}

      {profissional && !profissional.active && (
        <Cartao>
          <CartaoCorpo>
            <p role="alert" className="text-sm text-ink">
              Este profissional está desativado. Reative-o para consultar a agenda dele.
            </p>
          </CartaoCorpo>
        </Cartao>
      )}

      {profissional?.active && servicosElegiveis.length === 0 && (
        <Cartao>
          <CartaoCorpo>
            <p role="alert" className="text-sm text-ink">
              Este profissional não tem nenhum serviço ativo vinculado. Vincule um serviço para
              poder consultar a agenda.
            </p>
          </CartaoCorpo>
        </Cartao>
      )}

      {profissional?.active && servicosElegiveis.length > 0 && (
        <form onSubmit={aoConsultar} className="space-y-4" noValidate>
          <Cartao>
            <CartaoCorpo className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="servico" className="mb-1 block text-xs font-medium text-ink-soft">
                  Serviço
                </label>
                <select
                  id="servico"
                  value={serviceId}
                  disabled={consultando}
                  onChange={(e) => aoMudarSelecao(() => setServiceId(e.target.value))}
                  className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
                >
                  {servicosElegiveis.map((vinculo) => (
                    <option key={vinculo.serviceId} value={vinculo.serviceId}>
                      {vinculo.serviceName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="data" className="mb-1 block text-xs font-medium text-ink-soft">
                  Data
                </label>
                <input
                  id="data"
                  type="date"
                  value={date}
                  disabled={consultando}
                  onChange={(e) => aoMudarSelecao(() => setDate(e.target.value))}
                  className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
                />
              </div>
            </CartaoCorpo>
          </Cartao>

          <div className="flex gap-2">
            <Botao type="submit" disabled={consultando || !date} aria-busy={consultando}>
              <CalendarSearch size={16} className="mr-1" />
              {consultando ? "Consultando..." : "Consultar horários"}
            </Botao>
            <Botao
              type="button"
              variante="secundaria"
              disabled={consultando}
              onClick={() => router.push("/conta/profissionais")}
            >
              Voltar para profissionais
            </Botao>
          </div>
        </form>
      )}

      {consultando && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {estado.status === "falha" && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <p role="alert" className="text-sm text-ink">
              {mensagemFalhaDisponibilidade(estado.falha)}
            </p>
            {/* Sem permissão não ganha "tentar de novo": repetir não muda o
                resultado e só pareceria um cadeado quebrável. */}
            {estado.falha.tipo !== "sem_permissao" && estado.falha.tipo !== "sem_acesso" && (
              <Botao type="button" onClick={() => consultar({ serviceId, date })}>
                Tentar novamente
              </Botao>
            )}
          </CartaoCorpo>
        </Cartao>
      )}

      {estado.status === "carregada" && <Resultado disponibilidade={estado.disponibilidade} />}
    </Pagina>
  );
}

function Resultado({ disponibilidade }: { disponibilidade: DisponibilidadeReal }) {
  const slots = marcarAmbiguos(disponibilidade.slots);

  return (
    <div className="space-y-4">
      <Cartao>
        <CartaoCorpo className="flex items-start gap-3">
          <Clock size={18} className="mt-0.5 shrink-0 text-ink-soft" />
          <div>
            <p className="text-sm text-ink">
              {rotuloDaData(disponibilidade.date)} · fuso do estabelecimento:{" "}
              <strong className="font-semibold">{disponibilidade.timezone}</strong>
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft">
              {regrasAplicadas(disponibilidade).map((regra) => (
                <li key={regra}>{regra}</li>
              ))}
            </ul>
          </div>
        </CartaoCorpo>
      </Cartao>

      {slots.length === 0 ? (
        <Cartao>
          <CartaoCorpo>
            <p data-testid="sem-horarios" className="text-sm text-ink">
              {disponibilidade.emptyReason
                ? mensagemSemHorario(disponibilidade.emptyReason)
                : "Não há horário livre neste dia."}
            </p>
          </CartaoCorpo>
        </Cartao>
      ) : (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <p className="text-sm text-ink-soft">
              <strong className="font-semibold text-ink">{slots.length}</strong>{" "}
              {slots.length === 1 ? "horário livre" : "horários livres"}
            </p>
            <ul data-testid="horarios" className="flex flex-wrap gap-2">
              {slots.map((slot) => (
                <li
                  key={slot.startAt}
                  data-testid="horario"
                  data-inicio={slot.startAt}
                  className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-ink"
                >
                  <span className="font-semibold">{slot.localStart}</span>
                  <span className="text-ink-soft"> — {slot.localEnd}</span>
                  {/* Só onde a hora local se repete (fim do horário de verão):
                      sem isto, duas linhas ficariam indistinguíveis. */}
                  {slot.ambiguo && (
                    <span className="ml-1 text-[11px] text-ink-soft">({slot.offsetLabel})</span>
                  )}
                </li>
              ))}
            </ul>
          </CartaoCorpo>
        </Cartao>
      )}
    </div>
  );
}

function Pagina({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
      <div>
        <Link
          href="/conta/profissionais"
          className="text-xs font-medium text-accent hover:underline"
        >
          <ArrowLeft size={12} className="mr-1 inline" />
          Voltar para profissionais
        </Link>
        <h1 className="mt-2 text-xl font-bold text-ink">{titulo}</h1>
        {subtitulo && <p className="text-sm text-ink-soft">{subtitulo}</p>}
      </div>
      {children}
    </div>
  );
}
