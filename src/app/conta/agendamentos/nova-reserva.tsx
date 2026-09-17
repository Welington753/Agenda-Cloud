"use client";

// Formulário de nova reserva (Lote 6D.5): cliente, profissional, serviço,
// horário vindo da API de disponibilidade, resumo e confirmação.
//
// Os horários NUNCA são montados no navegador: cada opção é um slot devolvido
// pelo backend, e o que é enviado é o `startAt` (instante ISO) exato daquele
// slot. Remontar "09:00" localmente erraria no dia em que o relógio volta.
//
// Envio duplicado é barrado em dois lugares: o `disabled` do botão e uma
// segunda checagem no handler, para um clique já despachado antes do
// re-render nunca virar um segundo POST.
import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Info } from "lucide-react";
import type {
  AgendamentoReal,
  ClienteReal,
  DadosClienteNovo,
  SelecaoDeCliente,
} from "@/lib/api/appointments-api";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import { useDisponibilidadeReal } from "@/lib/profissionais/use-disponibilidade-real";
import { mensagemFalhaDisponibilidade, mensagemSemHorario } from "@/lib/profissionais/disponibilidade";
import { rotuloDeDuracao } from "@/lib/profissionais/agendamentos";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { SeletorCliente } from "./seletor-cliente";

interface NovaReservaProps {
  tenantId: string;
  date: string;
  profissionais: ProfissionalReal[];
  gravando: boolean;
  erro: string | null;
  aoConfirmar: (dados: {
    professionalId: string;
    serviceId: string;
    startAt: string;
    consumer: SelecaoDeCliente;
  }) => Promise<AgendamentoReal | null>;
}

export function NovaReserva({
  tenantId,
  date,
  profissionais,
  gravando,
  erro,
  aoConfirmar,
}: NovaReservaProps) {
  const ativos = useMemo(() => profissionais.filter((p) => p.active), [profissionais]);

  const [professionalId, setProfessionalId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [clienteExistente, setClienteExistente] = useState<ClienteReal | null>(null);
  const [clienteNovo, setClienteNovo] = useState<DadosClienteNovo | null>(null);

  const disponibilidade = useDisponibilidadeReal(tenantId, professionalId || null);
  // Desestruturado para o efeito abaixo depender da função estável, e não do
  // objeto recriado a cada render.
  const { limpar: limparDisponibilidade } = disponibilidade;

  const profissional = ativos.find((p) => p.id === professionalId);
  const servicosElegiveis = useMemo(
    () => (profissional?.services ?? []).filter((v) => v.serviceActive),
    [profissional],
  );

  // Pré-seleciona o primeiro profissional ativo, sem sobrescrever escolha.
  useEffect(() => {
    if (!professionalId && ativos.length > 0) setProfessionalId(ativos[0].id);
  }, [professionalId, ativos]);

  // Trocar de profissional invalida o serviço escolhido: os vínculos são
  // outros. Nunca manter um serviço que aquele profissional não realiza.
  useEffect(() => {
    if (servicosElegiveis.length === 0) {
      setServiceId("");
      return;
    }
    if (!servicosElegiveis.some((v) => v.serviceId === serviceId)) {
      setServiceId(servicosElegiveis[0].serviceId);
    }
  }, [servicosElegiveis, serviceId]);

  // Qualquer mudança na seleção invalida o horário já escolhido e o resultado
  // de disponibilidade na tela — os dois passariam a não corresponder aos
  // campos.
  useEffect(() => {
    setStartAt("");
    limparDisponibilidade();
  }, [professionalId, serviceId, date, limparDisponibilidade]);

  const selecaoCliente: SelecaoDeCliente | null = clienteExistente
    ? { mode: "existing", consumerId: clienteExistente.id }
    : clienteNovo
      ? { mode: "new", data: clienteNovo }
      : null;

  const estado = disponibilidade.estado;
  const consultando = estado.status === "consultando";
  const slots = estado.status === "carregada" ? estado.disponibilidade.slots : [];
  const slotEscolhido = slots.find((s) => s.startAt === startAt);
  const podeConfirmar = !!selecaoCliente && !!slotEscolhido && !gravando;

  async function confirmar(evento: React.FormEvent) {
    evento.preventDefault();
    // Segunda barreira contra envio duplicado, além do `disabled` do botão.
    if (!podeConfirmar || !selecaoCliente || !slotEscolhido) return;

    const criado = await aoConfirmar({
      professionalId,
      serviceId,
      startAt: slotEscolhido.startAt,
      consumer: selecaoCliente,
    });

    if (criado) {
      // Só limpa quando a reserva foi de fato confirmada pelo servidor.
      setStartAt("");
      setClienteExistente(null);
      setClienteNovo(null);
      limparDisponibilidade();
    }
  }

  if (ativos.length === 0) {
    return (
      <Cartao>
        <CartaoCorpo>
          <p className="text-sm text-ink">
            Cadastre um profissional ativo antes de agendar.
          </p>
        </CartaoCorpo>
      </Cartao>
    );
  }

  return (
    <form onSubmit={(e) => void confirmar(e)} className="space-y-4" noValidate>
      <Cartao>
        <CartaoCorpo className="space-y-4">
          <p className="text-sm font-semibold text-ink">Nova reserva</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="profissional" className="mb-1 block text-xs font-medium text-ink-soft">
                Profissional
              </label>
              <select
                id="profissional"
                value={professionalId}
                disabled={gravando}
                onChange={(e) => setProfessionalId(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              >
                {ativos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="servico" className="mb-1 block text-xs font-medium text-ink-soft">
                Serviço
              </label>
              <select
                id="servico"
                value={serviceId}
                disabled={gravando || servicosElegiveis.length === 0}
                onChange={(e) => setServiceId(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              >
                {servicosElegiveis.length === 0 && <option value="">Nenhum serviço vinculado</option>}
                {servicosElegiveis.map((v) => (
                  <option key={v.serviceId} value={v.serviceId}>
                    {v.serviceName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <SeletorCliente
            tenantId={tenantId}
            selecao={selecaoCliente}
            clienteEscolhido={clienteExistente}
            desabilitado={gravando}
            aoEscolherExistente={(cliente) => {
              setClienteExistente(cliente);
              setClienteNovo(null);
            }}
            aoPreencherNovo={(dados) => {
              setClienteNovo(dados);
              if (dados) setClienteExistente(null);
            }}
          />
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Botao
              type="button"
              variante="secundaria"
              disabled={gravando || consultando || !serviceId}
              aria-busy={consultando}
              onClick={() => disponibilidade.consultar({ serviceId, date })}
            >
              {consultando ? "Consultando..." : "Ver horários livres"}
            </Botao>
            <span className="text-xs text-ink-soft">
              Os horários vêm da agenda real deste profissional.
            </span>
          </div>

          {estado.status === "falha" && (
            <p role="alert" className="text-sm text-[color:var(--color-danger)]">
              {mensagemFalhaDisponibilidade(estado.falha)}
            </p>
          )}

          {estado.status === "carregada" && slots.length === 0 && (
            <p data-testid="sem-horarios" className="text-sm text-ink">
              {estado.disponibilidade.emptyReason
                ? mensagemSemHorario(estado.disponibilidade.emptyReason)
                : "Não há horário livre neste dia."}
            </p>
          )}

          {slots.length > 0 && (
            <ul data-testid="horarios-livres" className="flex flex-wrap gap-2">
              {slots.map((slot) => {
                const escolhido = slot.startAt === startAt;
                return (
                  <li key={slot.startAt}>
                    <button
                      type="button"
                      data-testid="horario-livre"
                      data-inicio={slot.startAt}
                      disabled={gravando}
                      onClick={() => setStartAt(slot.startAt)}
                      className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-sm ${
                        escolhido ? "border-accent bg-paper-muted font-semibold" : "border-border"
                      }`}
                    >
                      {slot.localStart}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CartaoCorpo>
      </Cartao>

      {/* Resumo antes de confirmar: tudo o que será gravado, incluindo o que
          o servidor decide (duração e preço vêm da consulta, não do campo). */}
      {slotEscolhido && estado.status === "carregada" && (
        <Cartao>
          <CartaoCorpo className="space-y-1" data-testid="resumo">
            <p className="text-sm font-semibold text-ink">Confira antes de confirmar</p>
            <p className="text-sm text-ink">
              {slotEscolhido.localStart}–{slotEscolhido.localEnd} ·{" "}
              {servicosElegiveis.find((v) => v.serviceId === serviceId)?.serviceName} · com{" "}
              {profissional?.name}
            </p>
            <p className="text-sm text-ink">
              Cliente: {clienteExistente?.name ?? clienteNovo?.name ?? "— selecione um cliente —"}
            </p>
            <p className="text-xs text-ink-soft">
              {rotuloDeDuracao(estado.disponibilidade.durationMinutes)} ·{" "}
              {estado.disponibilidade.bufferAfterMinutes > 0
                ? `${rotuloDeDuracao(estado.disponibilidade.bufferAfterMinutes)} de intervalo depois · `
                : ""}
              fuso {estado.disponibilidade.timezone}
            </p>
            {/* O preço não aparece aqui: quem congela o valor é o servidor,
                no momento da gravação, e a consulta de disponibilidade não
                devolve preço. Mostrar um número agora seria inventá-lo. */}
          </CartaoCorpo>
        </Cartao>
      )}

      {erro && (
        <p
          role="alert"
          data-testid="erro-reserva"
          className="text-sm text-[color:var(--color-danger)]"
        >
          {erro}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Botao type="submit" disabled={!podeConfirmar} aria-busy={gravando}>
          <CalendarPlus size={16} className="mr-1" />
          {gravando ? "Confirmando..." : "Confirmar agendamento"}
        </Botao>
        {!slotEscolhido && (
          <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
            <Info size={12} />
            Escolha um horário livre para confirmar.
          </span>
        )}
      </div>
    </form>
  );
}
