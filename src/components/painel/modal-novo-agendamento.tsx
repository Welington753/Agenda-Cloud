"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Botao } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatarDataLonga, formatarHora, formatarWhatsapp } from "@/lib/format";
import { horarioAindaDisponivelParaProfissional, horariosLivresDoProfissionalNoDia } from "@/lib/availability/consulta";
import { agendamentoRepository, consumidorRepository } from "@/lib/repositories";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { Estabelecimento, Profissional, Servico } from "@/lib/types";

interface ModalNovoAgendamentoProps {
  aberto: boolean;
  aoFechar: () => void;
  estabelecimento: Estabelecimento;
  profissionais: Profissional[];
  servicos: Servico[];
  dia: Date;
  profissionalPreSelecionadoId?: string;
  terminologia: Terminologia;
  onCriado: () => void;
}

export function ModalNovoAgendamento({
  aberto,
  aoFechar,
  estabelecimento,
  profissionais,
  servicos,
  dia,
  profissionalPreSelecionadoId,
  terminologia,
  onCriado,
}: ModalNovoAgendamentoProps) {
  const { notificar } = useToast();
  const [servicoId, setServicoId] = useState("");
  const [profissionalId, setProfissionalId] = useState(profissionalPreSelecionadoId ?? "");
  const [horario, setHorario] = useState<Date | null>(null);
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [versaoHorarios, setVersaoHorarios] = useState(0);

  useEffect(() => {
    if (aberto) {
      setServicoId("");
      setProfissionalId(profissionalPreSelecionadoId ?? "");
      setHorario(null);
      setNome("");
      setWhatsapp("");
      setVersaoHorarios(0);
    }
  }, [aberto, profissionalPreSelecionadoId]);

  const servico = servicos.find((s) => s.id === servicoId);
  const profissionaisCapacitados = servico ? profissionais.filter((p) => p.servicosIds.includes(servico.id)) : [];
  const profissional = profissionaisCapacitados.find((p) => p.id === profissionalId);

  const horarios = useMemo(() => {
    if (!servico || !profissional) return [];
    return horariosLivresDoProfissionalNoDia(profissional, servico, dia, estabelecimento);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servico, profissional, dia, estabelecimento, versaoHorarios]);

  function confirmar() {
    if (!servico || !profissional || !horario) return;
    if (!nome.trim() || whatsapp.replace(/\D/g, "").length < 10) {
      notificar("Preencha nome e WhatsApp válidos.", "erro");
      return;
    }
    if (!horarioAindaDisponivelParaProfissional(profissional, servico, horario, estabelecimento)) {
      notificar("Esse horário deixou de estar disponível. Escolha outro horário.", "erro");
      setHorario(null);
      setVersaoHorarios((v) => v + 1);
      return;
    }
    const consumidor = consumidorRepository.obterOuCriarPorWhatsapp(estabelecimento.tenantId, nome.trim(), whatsapp);
    const fim = new Date(horario.getTime() + servico.duracaoMinutos * 60_000);
    agendamentoRepository.criar({
      tenantId: estabelecimento.tenantId,
      consumidorId: consumidor.id,
      consumidorNome: nome.trim(),
      consumidorWhatsapp: whatsapp,
      profissionalId: profissional.id,
      servicoId: servico.id,
      dataHoraInicio: horario.toISOString(),
      dataHoraFim: fim.toISOString(),
      status: "confirmado",
      precoCentavos: servico.precoCentavos,
    });
    notificar("Agendamento criado com sucesso.", "sucesso");
    onCriado();
    aoFechar();
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={`${terminologia.agendamento.artigo === "a" ? "Nova" : "Novo"} ${terminologia.agendamento.singular.toLowerCase()} — ${formatarDataLonga(dia)}`}
    >
      <div className="space-y-3">
        <Campo rotulo={terminologia.servico.singular}>
          <select
            value={servicoId}
            onChange={(e) => {
              setServicoId(e.target.value);
              setProfissionalId(profissionalPreSelecionadoId ?? "");
              setHorario(null);
            }}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          >
            <option value="">Selecione...</option>
            {servicos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo={terminologia.profissional.singular}>
          <select
            value={profissionalId}
            onChange={(e) => {
              setProfissionalId(e.target.value);
              setHorario(null);
            }}
            disabled={!servico}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink disabled:opacity-50"
          >
            <option value="">Selecione...</option>
            {profissionaisCapacitados.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </Campo>

        {profissional && servico && (
          <Campo rotulo="Horário">
            {horarios.length === 0 ? (
              <p className="text-sm text-ink-soft">
                Nenhum horário livre neste dia para {terminologia.profissional.artigo === "a" ? "esta" : "este"}{" "}
                {terminologia.profissional.singular.toLowerCase()}.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {horarios.map((h) => (
                  <button
                    key={h.toISOString()}
                    type="button"
                    onClick={() => setHorario(h)}
                    className={`rounded-[var(--radius-control)] border px-2 py-2 text-xs font-semibold ${
                      horario?.getTime() === h.getTime() ? "border-accent bg-accent text-white" : "border-border text-ink hover:border-accent"
                    }`}
                  >
                    {formatarHora(h)}
                  </button>
                ))}
              </div>
            )}
          </Campo>
        )}

        <Campo rotulo={`Nome ${terminologia.consumidor.artigo === "a" ? "da" : "do"} ${terminologia.consumidor.singular.toLowerCase()}`}>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        </Campo>

        <Campo rotulo="WhatsApp">
          <input
            type="tel"
            inputMode="numeric"
            value={whatsapp}
            onChange={(e) => setWhatsapp(formatarWhatsapp(e.target.value))}
            placeholder="(11) 99999-9999"
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        </Campo>
      </div>

      <div className="mt-5">
        <Botao className="w-full" disabled={!horario} onClick={confirmar}>
          Criar {terminologia.agendamento.singular.toLowerCase()}
        </Botao>
      </div>
    </Modal>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-ink-soft">{rotulo}</label>
      {children}
    </div>
  );
}
