"use client";

// Formulário de criação e edição de serviço real (Lote 6D.1). Os campos são
// exatamente as colunas de `services` — nenhum inventado. Extraído da página
// para manter os dois arquivos dentro do orçamento do lint
// (`quality/max-lines`).
//
// Dinheiro nunca passa por ponto flutuante: o texto digitado vira centavos
// inteiros em `precoParaCentavos` (ver lib/servicos/dinheiro.ts).
import { useState, type FormEvent } from "react";
import type { DadosServicoReal, ModalidadeServicoReal, ServicoReal } from "@/lib/api/services-api";
import { centavosParaCampo, precoParaCentavos } from "@/lib/servicos/dinheiro";
import { Botao } from "@/components/ui/button";

const MODALIDADES: { valor: ModalidadeServicoReal; rotulo: string }[] = [
  { valor: "IN_PERSON", rotulo: "Presencial" },
  { valor: "REMOTE", rotulo: "Remoto" },
  { valor: "HOME", rotulo: "No endereço do cliente" },
];

interface FormularioServicoProps {
  /** Ausente = criação. */
  servico?: ServicoReal;
  enviando: boolean;
  erro: string | null;
  aoEnviar: (dados: DadosServicoReal) => void;
  aoCancelar: () => void;
}

const CLASSE_CAMPO =
  "w-full rounded-[var(--radius-control)] border bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent";

export function FormularioServico({
  servico,
  enviando,
  erro,
  aoEnviar,
  aoCancelar,
}: FormularioServicoProps) {
  const [nome, setNome] = useState(servico?.name ?? "");
  const [descricao, setDescricao] = useState(servico?.shortDescription ?? "");
  const [preco, setPreco] = useState(centavosParaCampo(servico?.priceCents ?? null));
  const [duracao, setDuracao] = useState(String(servico?.durationMinutes ?? 30));
  const [intervalo, setIntervalo] = useState(String(servico?.bufferAfterMinutes ?? 0));
  const [modalidade, setModalidade] = useState<ModalidadeServicoReal>(
    servico?.modality ?? "IN_PERSON",
  );
  const [precoVisivel, setPrecoVisivel] = useState(servico?.priceVisible ?? true);
  const [errosCampo, setErrosCampo] = useState<Record<string, string>>({});

  function validar(): DadosServicoReal | null {
    const erros: Record<string, string> = {};

    const nomeLimpo = nome.trim();
    if (nomeLimpo === "") erros.nome = "Informe o nome do serviço.";

    const precoConvertido = precoParaCentavos(preco);
    if (!precoConvertido.ok) erros.preco = precoConvertido.erro;

    const duracaoNumero = Number(duracao);
    if (!Number.isInteger(duracaoNumero) || duracaoNumero < 1) {
      erros.duracao = "Informe a duração em minutos inteiros, a partir de 1.";
    }

    const intervaloNumero = intervalo.trim() === "" ? 0 : Number(intervalo);
    if (!Number.isInteger(intervaloNumero) || intervaloNumero < 0) {
      erros.intervalo = "Informe o intervalo em minutos inteiros, a partir de 0.";
    }

    setErrosCampo(erros);
    if (Object.keys(erros).length > 0 || !precoConvertido.ok) return null;

    return {
      name: nomeLimpo,
      shortDescription: descricao.trim(),
      priceCents: precoConvertido.centavos,
      priceVisible: precoVisivel,
      durationMinutes: duracaoNumero,
      bufferAfterMinutes: intervaloNumero,
      modality: modalidade,
      // Mantidos como estão na edição; no cadastro seguem o default da coluna.
      activeInPublicBooking: servico?.activeInPublicBooking ?? true,
      requiresManualConfirmation: servico?.requiresManualConfirmation ?? false,
    };
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const dados = validar();
    if (dados) aoEnviar(dados);
  }

  function campo(id: string, rotulo: string, conteudo: React.ReactNode, dica?: string) {
    return (
      <div>
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
          {rotulo}
        </label>
        {conteudo}
        {dica && !errosCampo[id] && <p className="mt-1 text-xs text-ink-soft">{dica}</p>}
        {errosCampo[id] && (
          <p id={`${id}-erro`} className="mt-1 text-xs text-[color:var(--color-danger)]">
            {errosCampo[id]}
          </p>
        )}
      </div>
    );
  }

  function classe(id: string): string {
    return `${CLASSE_CAMPO} ${errosCampo[id] ? "border-[color:var(--color-danger)]" : "border-border"}`;
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      {campo(
        "nome",
        "Nome do serviço",
        <input
          id="nome"
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          aria-invalid={errosCampo.nome ? true : undefined}
          aria-describedby={errosCampo.nome ? "nome-erro" : undefined}
          className={classe("nome")}
          placeholder="Atendimento padrão"
        />,
      )}

      {campo(
        "descricao",
        "Descrição curta",
        <input
          id="descricao"
          type="text"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          className={classe("descricao")}
          placeholder="Opcional"
        />,
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {campo(
          "duracao",
          "Duração (minutos)",
          <input
            id="duracao"
            type="number"
            min={1}
            step={1}
            value={duracao}
            onChange={(e) => setDuracao(e.target.value)}
            aria-invalid={errosCampo.duracao ? true : undefined}
            aria-describedby={errosCampo.duracao ? "duracao-erro" : undefined}
            className={classe("duracao")}
          />,
        )}

        {campo(
          "intervalo",
          "Intervalo após (minutos)",
          <input
            id="intervalo"
            type="number"
            min={0}
            step={1}
            value={intervalo}
            onChange={(e) => setIntervalo(e.target.value)}
            aria-invalid={errosCampo.intervalo ? true : undefined}
            aria-describedby={errosCampo.intervalo ? "intervalo-erro" : undefined}
            className={classe("intervalo")}
          />,
        )}
      </div>

      {campo(
        "preco",
        "Preço",
        <input
          id="preco"
          type="text"
          inputMode="decimal"
          value={preco}
          onChange={(e) => setPreco(e.target.value)}
          aria-invalid={errosCampo.preco ? true : undefined}
          aria-describedby={errosCampo.preco ? "preco-erro" : undefined}
          className={classe("preco")}
          placeholder="85,50"
        />,
        "Deixe em branco para divulgar como “sob consulta”.",
      )}

      {campo(
        "modalidade",
        "Modalidade",
        <select
          id="modalidade"
          value={modalidade}
          onChange={(e) => setModalidade(e.target.value as ModalidadeServicoReal)}
          className={classe("modalidade")}
        >
          {MODALIDADES.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.rotulo}
            </option>
          ))}
        </select>,
      )}

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={precoVisivel}
          onChange={(e) => setPrecoVisivel(e.target.checked)}
        />
        Mostrar o preço na página pública
      </label>

      {erro && (
        <p role="alert" className="text-sm text-[color:var(--color-danger)]">
          {erro}
        </p>
      )}

      <div className="flex gap-2">
        <Botao type="submit" disabled={enviando} aria-busy={enviando}>
          {enviando ? "Salvando..." : servico ? "Salvar alterações" : "Cadastrar serviço"}
        </Botao>
        <Botao type="button" variante="secundaria" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
