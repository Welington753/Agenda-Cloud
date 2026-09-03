import { useState } from "react";
import { QUALQUER_PROFISSIONAL } from "@/components/agendamento/etapa-profissional";
import type { Servico } from "@/lib/types";

/** Estado do assistente de agendamento público em si (etapa atual, seleção
 * de serviço/profissional/data/horário, dados do cliente) — não sabe nada
 * sobre disponibilidade nem sobre gravar o agendamento, só sobre o que o
 * visitante escolheu até agora. */
export function useFluxoAgendamento() {
  const [etapa, setEtapa] = useState(0);
  const [servico, setServico] = useState<Servico | null>(null);
  const [escolhaProfissional, setEscolhaProfissional] = useState<string | typeof QUALQUER_PROFISSIONAL | null>(null);
  const [dataSelecionada, setDataSelecionada] = useState<Date | null>(null);
  const [horarioSelecionado, setHorarioSelecionado] = useState<Date | null>(null);
  const [profissionalResolvidoId, setProfissionalResolvidoId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [erros, setErros] = useState<{ nome?: string; whatsapp?: string }>({});
  const [enviando, setEnviando] = useState(false);

  function irParaEtapaAnterior() {
    setEtapa((e) => Math.max(0, e - 1));
  }

  function validarDados(exigirTelefoneCliente: boolean): boolean {
    const novosErros: { nome?: string; whatsapp?: string } = {};
    if (!nome.trim()) novosErros.nome = "Informe seu nome.";
    const digitos = whatsapp.replace(/\D/g, "");
    if (exigirTelefoneCliente && digitos.length < 10) {
      novosErros.whatsapp = "Informe um WhatsApp válido com DDD.";
    }
    setErros(novosErros);
    return Object.keys(novosErros).length === 0;
  }

  return {
    etapa,
    setEtapa,
    servico,
    setServico,
    escolhaProfissional,
    setEscolhaProfissional,
    dataSelecionada,
    setDataSelecionada,
    horarioSelecionado,
    setHorarioSelecionado,
    profissionalResolvidoId,
    setProfissionalResolvidoId,
    nome,
    setNome,
    whatsapp,
    setWhatsapp,
    erros,
    enviando,
    setEnviando,
    irParaEtapaAnterior,
    validarDados,
  };
}
