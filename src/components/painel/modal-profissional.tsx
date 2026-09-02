"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Botao } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { profissionalRepository } from "@/lib/repositories";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { DiaSemana, HorarioDia, Profissional, Servico } from "@/lib/types";

const DIAS: { valor: DiaSemana; rotulo: string }[] = [
  { valor: 1, rotulo: "Segunda" },
  { valor: 2, rotulo: "Terça" },
  { valor: 3, rotulo: "Quarta" },
  { valor: 4, rotulo: "Quinta" },
  { valor: 5, rotulo: "Sexta" },
  { valor: 6, rotulo: "Sábado" },
  { valor: 0, rotulo: "Domingo" },
];

const CORES_AVATAR = ["#B5651D", "#3B5A6B", "#6B4226", "#2F6F4E", "#8A4B6B", "#4A453E"];

function horarioPadrao(dia: DiaSemana): HorarioDia {
  return { diaSemana: dia, ativo: false, inicio: "09:00", fim: "19:00" };
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "PR";
}

interface ModalProfissionalProps {
  aberto: boolean;
  aoFechar: () => void;
  tenantId: string;
  servicos: Servico[];
  profissionalEmEdicao: Profissional | null;
  terminologia: Terminologia;
  /** Defesa em profundidade: a página só abre este modal se `profissionais.gerenciar`
   * já estiver liberado, mas `salvar()` confere de novo antes de gravar. */
  podeSalvar: boolean;
  onSalvo: () => void;
}

export function ModalProfissional({
  aberto,
  aoFechar,
  tenantId,
  servicos,
  profissionalEmEdicao,
  terminologia,
  podeSalvar,
  onSalvo,
}: ModalProfissionalProps) {
  const { notificar } = useToast();
  const [nome, setNome] = useState("");
  const [corAvatar, setCorAvatar] = useState(CORES_AVATAR[0]);
  const [servicosIds, setServicosIds] = useState<string[]>([]);
  const [horarios, setHorarios] = useState<HorarioDia[]>(DIAS.map((d) => horarioPadrao(d.valor)));
  const [agendamentoOnlineAtivo, setAgendamentoOnlineAtivo] = useState(true);

  useEffect(() => {
    if (!aberto) return;
    if (profissionalEmEdicao) {
      setNome(profissionalEmEdicao.nome);
      setCorAvatar(profissionalEmEdicao.corAvatar);
      setServicosIds(profissionalEmEdicao.servicosIds);
      setHorarios(
        DIAS.map((d) => profissionalEmEdicao.horarios.find((h) => h.diaSemana === d.valor) ?? horarioPadrao(d.valor))
      );
      setAgendamentoOnlineAtivo(profissionalEmEdicao.agendamentoOnlineAtivo);
    } else {
      setNome("");
      setCorAvatar(CORES_AVATAR[Math.floor(Math.random() * CORES_AVATAR.length)]);
      setServicosIds([]);
      setHorarios(DIAS.map((d) => horarioPadrao(d.valor)));
      setAgendamentoOnlineAtivo(true);
    }
  }, [aberto, profissionalEmEdicao]);

  function atualizarHorario(dia: DiaSemana, patch: Partial<HorarioDia>) {
    setHorarios((atual) => atual.map((h) => (h.diaSemana === dia ? { ...h, ...patch } : h)));
  }

  function alternarServico(id: string) {
    setServicosIds((atual) => (atual.includes(id) ? atual.filter((s) => s !== id) : [...atual, id]));
  }

  function salvar() {
    if (!podeSalvar) return;
    if (!nome.trim()) {
      notificar(`Informe o nome ${terminologia.profissional.artigo === "a" ? "da" : "do"} ${terminologia.profissional.singular.toLowerCase()}.`, "erro");
      return;
    }
    const dados = {
      tenantId,
      nome: nome.trim(),
      avatarIniciais: iniciais(nome),
      corAvatar,
      servicosIds,
      horarios,
      agendamentoOnlineAtivo,
      ativo: true,
    };
    if (profissionalEmEdicao) {
      profissionalRepository.atualizar(profissionalEmEdicao.id, dados);
      notificar(`${terminologia.profissional.singular} atualizado(a).`, "sucesso");
    } else {
      profissionalRepository.criar(dados);
      notificar(`${terminologia.profissional.singular} cadastrado(a).`, "sucesso");
    }
    onSalvo();
    aoFechar();
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={
        profissionalEmEdicao
          ? `Editar ${terminologia.profissional.singular.toLowerCase()}`
          : `Nov${terminologia.profissional.artigo === "a" ? "a" : "o"} ${terminologia.profissional.singular.toLowerCase()}`
      }
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Nome</label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Cor do avatar</label>
          <div className="flex gap-2">
            {CORES_AVATAR.map((cor) => (
              <button
                key={cor}
                type="button"
                aria-label={`Cor ${cor}`}
                onClick={() => setCorAvatar(cor)}
                className="size-7 rounded-full"
                style={{
                  backgroundColor: cor,
                  boxShadow: cor === corAvatar ? `0 0 0 2px var(--color-card), 0 0 0 4px ${cor}` : "none",
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">{terminologia.servico.plural} realizados</label>
          <div className="flex flex-wrap gap-2">
            {servicos.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => alternarServico(s.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  servicosIds.includes(s.id) ? "border-accent bg-accent text-white" : "border-border text-ink-soft"
                }`}
              >
                {s.nome}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Horários de atendimento</label>
          <div className="space-y-2">
            {DIAS.map((d) => {
              const h = horarios.find((x) => x.diaSemana === d.valor)!;
              return (
                <div key={d.valor} className="rounded-[var(--radius-control)] border border-border p-2.5">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={h.ativo}
                      onChange={(e) => atualizarHorario(d.valor, { ativo: e.target.checked })}
                    />
                    {d.rotulo}
                  </label>
                  {h.ativo && (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <CampoHora rotulo="Início" valor={h.inicio} onMudar={(v) => atualizarHorario(d.valor, { inicio: v })} />
                      <CampoHora rotulo="Fim" valor={h.fim} onMudar={(v) => atualizarHorario(d.valor, { fim: v })} />
                      <CampoHora
                        rotulo="Almoço de"
                        valor={h.almocoInicio ?? ""}
                        onMudar={(v) => atualizarHorario(d.valor, { almocoInicio: v || undefined })}
                      />
                      <CampoHora
                        rotulo="Até"
                        valor={h.almocoFim ?? ""}
                        onMudar={(v) => atualizarHorario(d.valor, { almocoFim: v || undefined })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={agendamentoOnlineAtivo}
            onChange={(e) => setAgendamentoOnlineAtivo(e.target.checked)}
          />
          Aceita agendamento online
        </label>
      </div>

      <div className="mt-5">
        <Botao className="w-full" onClick={salvar} disabled={!podeSalvar}>
          Salvar {terminologia.profissional.singular.toLowerCase()}
        </Botao>
      </div>
    </Modal>
  );
}

function CampoHora({ rotulo, valor, onMudar }: { rotulo: string; valor: string; onMudar: (v: string) => void }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] text-ink-soft">{rotulo}</span>
      <input
        type="time"
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        className="w-full rounded-[var(--radius-control)] border border-border bg-card px-2 py-1.5 text-sm text-ink"
      />
    </div>
  );
}
