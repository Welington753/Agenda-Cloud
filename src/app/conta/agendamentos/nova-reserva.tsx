"use client";

// Formulário de nova reserva (Lote 6D.5): cliente, profissional, um ou mais
// serviços (todos com o MESMO profissional, entre os que ele realiza),
// horário vindo da API de disponibilidade, resumo e confirmação. Itens,
// preço total e duração total do resumo vêm da consulta ao servidor, que
// recalcula tudo de novo ao gravar.
//
// Os horários NUNCA são montados no navegador: cada opção é um slot devolvido
// pelo backend, e o que é enviado é o `startAt` (instante ISO) exato daquele
// slot. Remontar "09:00" localmente erraria no dia em que o relógio volta.
//
// Envio duplicado é barrado em dois lugares: o `disabled` do botão e uma
// segunda checagem no handler, para um clique já despachado antes do
// re-render nunca virar um segundo POST.
//
// Vive dentro do painel "Novo agendamento" (painel-nova-reserva.tsx), que o
// monta limpo a cada abertura e o fecha depois do sucesso.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarPlus, Info } from "lucide-react";
import type {
  AgendamentoReal,
  ClienteReal,
  DadosClienteNovo,
  SelecaoDeCliente,
} from "@/lib/api/appointments-api";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import { useDisponibilidadeReal } from "@/lib/profissionais/use-disponibilidade-real";
import {
  mensagemFalhaDisponibilidade,
  mensagemSemHorario,
} from "@/lib/profissionais/disponibilidade";
import { rotuloDeDuracao } from "@/lib/profissionais/agendamentos";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { BotaoHorario } from "./botao-horario";
import { SeletorCliente } from "./seletor-cliente";
import { ResumoDosItens, SelecaoDeServicos } from "./selecao-de-servicos";

interface NovaReservaProps {
  tenantId: string;
  date: string;
  profissionais: ProfissionalReal[];
  /** Pré-seleção inicial (o profissional do filtro da agenda), se ativo. */
  profissionalInicialId?: string | null;
  /** O que mostrar quando não há profissional ativo. */
  semProfissional?: ReactNode;
  gravando: boolean;
  erro: string | null;
  aoConfirmar: (dados: {
    professionalId: string;
    serviceIds: string[];
    startAt: string;
    consumer: SelecaoDeCliente;
  }) => Promise<AgendamentoReal | null>;
}

export function NovaReserva({
  tenantId,
  date,
  profissionais,
  profissionalInicialId = null,
  semProfissional,
  gravando,
  erro,
  aoConfirmar,
}: NovaReservaProps) {
  const ativos = useMemo(() => profissionais.filter((p) => p.active), [profissionais]);

  const [professionalId, setProfessionalId] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
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

  // Pré-seleciona o profissional do filtro da agenda (se ativo) ou o primeiro
  // ativo, sem sobrescrever escolha.
  useEffect(() => {
    if (professionalId || ativos.length === 0) return;
    const inicial = ativos.find((p) => p.id === profissionalInicialId);
    setProfessionalId((inicial ?? ativos[0]).id);
  }, [professionalId, ativos, profissionalInicialId]);

  // Trocar de profissional mantém só os serviços que ele realiza: nunca fica
  // escolhido um serviço fora dos vínculos dele. Sem nenhum, o primeiro dele.
  useEffect(() => {
    setServiceIds((atuais) => {
      const validos = atuais.filter((id) => servicosElegiveis.some((v) => v.serviceId === id));
      if (validos.length > 0) return validos.length === atuais.length ? atuais : validos;
      return servicosElegiveis.length > 0 ? [servicosElegiveis[0].serviceId] : [];
    });
  }, [servicosElegiveis]);

  // Qualquer mudança na seleção invalida o horário já escolhido e o resultado
  // de disponibilidade na tela — os dois passariam a não corresponder aos
  // campos.
  useEffect(() => {
    setStartAt("");
    limparDisponibilidade();
  }, [professionalId, serviceIds, date, limparDisponibilidade]);

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
      serviceIds,
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
          {semProfissional ?? (
            <p className="text-sm text-ink">Cadastre um profissional ativo antes de agendar.</p>
          )}
        </CartaoCorpo>
      </Cartao>
    );
  }

  return (
    <form onSubmit={(e) => void confirmar(e)} className="space-y-4" noValidate>
      <Cartao>
        <CartaoCorpo className="space-y-4">
          <p className="text-sm font-semibold text-ink">Profissional, serviço e cliente</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="profissional"
                className="mb-1 block text-xs font-medium text-ink-soft"
              >
                Profissional
              </label>
              <select
                id="profissional"
                value={professionalId}
                disabled={gravando}
                onChange={(e) => setProfessionalId(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3 py-2 text-sm text-ink"
              >
                {ativos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

          </div>

          <SelecaoDeServicos
            elegiveis={servicosElegiveis}
            escolhidos={serviceIds}
            profissional={profissional?.name}
            desabilitado={gravando}
            aoMudar={setServiceIds}
          />

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
              disabled={gravando || consultando || serviceIds.length === 0}
              aria-busy={consultando}
              onClick={() => disponibilidade.consultar({ serviceIds, date })}
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
                    <BotaoHorario
                      selecionado={escolhido}
                      data-testid="horario-livre"
                      data-inicio={slot.startAt}
                      disabled={gravando}
                      onClick={() => setStartAt(slot.startAt)}
                    >
                      {slot.localStart}
                    </BotaoHorario>
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
              {slotEscolhido.localStart}–{slotEscolhido.localEnd} · com {profissional?.name}
            </p>
            <ResumoDosItens disponibilidade={estado.disponibilidade} />
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
            {/* Itens, preço e duração vêm da consulta ao servidor; quem
                congela os valores é o servidor, no momento da gravação. */}
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

