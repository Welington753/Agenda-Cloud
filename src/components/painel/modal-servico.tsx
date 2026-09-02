"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Botao } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { servicoRepository } from "@/lib/repositories";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { ModalidadeAtendimento, Profissional, Servico } from "@/lib/types";

const MODALIDADES: { valor: ModalidadeAtendimento; rotulo: string }[] = [
  { valor: "presencial", rotulo: "Presencial" },
  { valor: "remoto", rotulo: "Remoto" },
  { valor: "domiciliar", rotulo: "Domiciliar" },
];

interface ModalServicoProps {
  aberto: boolean;
  aoFechar: () => void;
  tenantId: string;
  profissionais: Profissional[];
  servicoEmEdicao: Servico | null;
  /** Prefill do intervalo posterior para serviços novos — vem da política do
   * estabelecimento (`regras.intervaloPadraoMinutos`). */
  intervaloPadraoMinutos: number;
  terminologia: Terminologia;
  /** Defesa em profundidade: a página só abre este modal se `servicos.gerenciar`
   * já estiver liberado, mas `salvar()` confere de novo antes de gravar. */
  podeSalvar: boolean;
  onSalvo: () => void;
}

export function ModalServico({
  aberto,
  aoFechar,
  tenantId,
  profissionais,
  servicoEmEdicao,
  intervaloPadraoMinutos,
  terminologia,
  podeSalvar,
  onSalvo,
}: ModalServicoProps) {
  const { notificar } = useToast();
  const [nome, setNome] = useState("");
  const [descricaoCurta, setDescricaoCurta] = useState("");
  const [preco, setPreco] = useState("");
  const [precoVisivel, setPrecoVisivel] = useState(true);
  const [duracaoMinutos, setDuracaoMinutos] = useState(30);
  const [intervaloPosteriorMinutos, setIntervaloPosteriorMinutos] = useState(intervaloPadraoMinutos);
  const [modalidade, setModalidade] = useState<ModalidadeAtendimento>("presencial");
  const [exigeConfirmacaoManual, setExigeConfirmacaoManual] = useState(false);
  const [profissionaisIds, setProfissionaisIds] = useState<string[]>([]);
  const [ativoNoAgendamentoPublico, setAtivoNoAgendamentoPublico] = useState(true);

  useEffect(() => {
    if (!aberto) return;
    if (servicoEmEdicao) {
      setNome(servicoEmEdicao.nome);
      setDescricaoCurta(servicoEmEdicao.descricaoCurta);
      setPreco(servicoEmEdicao.precoCentavos === undefined ? "" : (servicoEmEdicao.precoCentavos / 100).toFixed(2).replace(".", ","));
      setPrecoVisivel(servicoEmEdicao.precoVisivel);
      setDuracaoMinutos(servicoEmEdicao.duracaoMinutos);
      setIntervaloPosteriorMinutos(servicoEmEdicao.intervaloPosteriorMinutos);
      setModalidade(servicoEmEdicao.modalidade);
      setExigeConfirmacaoManual(servicoEmEdicao.exigeConfirmacaoManual);
      setProfissionaisIds(servicoEmEdicao.profissionaisIds);
      setAtivoNoAgendamentoPublico(servicoEmEdicao.ativoNoAgendamentoPublico);
    } else {
      setNome("");
      setDescricaoCurta("");
      setPreco("");
      setPrecoVisivel(true);
      setDuracaoMinutos(30);
      setIntervaloPosteriorMinutos(intervaloPadraoMinutos);
      setModalidade("presencial");
      setExigeConfirmacaoManual(false);
      setProfissionaisIds([]);
      setAtivoNoAgendamentoPublico(true);
    }
  }, [aberto, servicoEmEdicao, intervaloPadraoMinutos]);

  function alternarProfissional(id: string) {
    setProfissionaisIds((atual) => (atual.includes(id) ? atual.filter((p) => p !== id) : [...atual, id]));
  }

  function salvar() {
    if (!podeSalvar) return;
    if (!nome.trim()) {
      notificar("Informe o nome do serviço.", "erro");
      return;
    }
    const precoTexto = preco.trim();
    let precoCentavos: number | undefined;
    if (precoTexto) {
      const convertido = Math.round(parseFloat(precoTexto.replace(",", ".")) * 100);
      if (Number.isNaN(convertido) || convertido <= 0) {
        notificar("Informe um preço válido ou deixe em branco para 'sob consulta'.", "erro");
        return;
      }
      precoCentavos = convertido;
    }
    const dados = {
      tenantId,
      nome: nome.trim(),
      descricaoCurta: descricaoCurta.trim(),
      precoCentavos,
      precoVisivel,
      duracaoMinutos,
      intervaloPosteriorMinutos,
      modalidade,
      exigeConfirmacaoManual,
      profissionaisIds,
      ativoNoAgendamentoPublico,
      ativo: true,
    };
    if (servicoEmEdicao) {
      servicoRepository.atualizar(servicoEmEdicao.id, dados);
      notificar(`${terminologia.servico.singular} atualizado.`, "sucesso");
    } else {
      servicoRepository.criar(dados);
      notificar(`${terminologia.servico.singular} cadastrado.`, "sucesso");
    }
    onSalvo();
    aoFechar();
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={
        servicoEmEdicao
          ? `Editar ${terminologia.servico.singular.toLowerCase()}`
          : `Nov${terminologia.servico.artigo === "a" ? "a" : "o"} ${terminologia.servico.singular.toLowerCase()}`
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
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Descrição curta</label>
          <input
            type="text"
            value={descricaoCurta}
            onChange={(e) => setDescricaoCurta(e.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Preço (R$)</label>
            <input
              type="text"
              inputMode="decimal"
              value={preco}
              onChange={(e) => setPreco(e.target.value)}
              placeholder="Sob consulta"
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Duração (min)</label>
            <input
              type="number"
              min={5}
              step={5}
              value={duracaoMinutos}
              onChange={(e) => setDuracaoMinutos(Number(e.target.value))}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Intervalo após (min)</label>
            <input
              type="number"
              min={0}
              step={5}
              value={intervaloPosteriorMinutos}
              onChange={(e) => setIntervaloPosteriorMinutos(Number(e.target.value))}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Atendimento</label>
          <select
            value={modalidade}
            onChange={(e) => setModalidade(e.target.value as ModalidadeAtendimento)}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          >
            {MODALIDADES.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">
            {terminologia.profissional.plural} habilitad{terminologia.profissional.artigo === "a" ? "as" : "os"}
          </label>
          <div className="flex flex-wrap gap-2">
            {profissionais.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => alternarProfissional(p.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  profissionaisIds.includes(p.id) ? "border-accent bg-accent text-white" : "border-border text-ink-soft"
                }`}
              >
                {p.nome}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={ativoNoAgendamentoPublico}
            onChange={(e) => setAtivoNoAgendamentoPublico(e.target.checked)}
          />
          Disponível no agendamento público
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={precoVisivel} onChange={(e) => setPrecoVisivel(e.target.checked)} />
          Mostrar preço publicamente (quando não marcado, aparece &quot;Sob consulta&quot;)
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={exigeConfirmacaoManual}
            onChange={(e) => setExigeConfirmacaoManual(e.target.checked)}
          />
          Exige confirmação manual (nunca nasce já confirmado)
        </label>
      </div>

      <div className="mt-5">
        <Botao className="w-full" onClick={salvar} disabled={!podeSalvar}>
          Salvar {terminologia.servico.singular.toLowerCase()}
        </Botao>
      </div>
    </Modal>
  );
}
