"use client";

// Formulário pequeno dentro do cadastro de produto ("+ Nova categoria" e
// "+ Nova subcategoria"). Não é um <form> (ficaria dentro do formulário do
// produto): Enter no campo salva sem enviar o produto. Quem grava é a página,
// pelas mesmas rotas da tela de Categorias; aqui só fica o nome e o erro.
// Cancelar ou errar não toca nos campos do produto.
import { useEffect, useRef, useState } from "react";
import type { CategoriaEstoque, ResultadoEstoque } from "@/lib/api/estoque-api";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { Botao } from "@/components/ui/button";
import { CLASSE_CAMPO, CLASSE_ROTULO, ErroDoFormulario } from "@/components/estoque/comum";

export type ResultadoDoAtalho = { ok: true; id: string } | { ok: false; erro: string };

export function AtalhoDeNome({
  id,
  rotulo,
  enviando,
  aoSalvar,
  aoCancelar,
}: {
  id: string;
  rotulo: string;
  enviando: boolean;
  /** Devolve o erro para mostrar, ou nada quando gravou (a página fecha). */
  aoSalvar: (nome: string) => Promise<string | null>;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    campo.current?.focus();
  }, []);

  async function salvar() {
    if (enviando) return;
    if (!nome.trim()) {
      setErro("Informe o nome.");
      return;
    }
    setErro(null);
    const falha = await aoSalvar(nome.trim());
    if (falha) setErro(falha);
  }

  return (
    <div role="group" aria-labelledby={`${id}-rotulo`} className="space-y-2 rounded-[var(--radius-control)] border border-border bg-paper-muted p-3 sm:col-span-2" data-testid={id}>
      <label id={`${id}-rotulo`} htmlFor={`${id}-campo`} className={CLASSE_ROTULO}>
        {rotulo}
      </label>
      <input
        id={`${id}-campo`}
        ref={campo}
        className={CLASSE_CAMPO}
        value={nome}
        maxLength={60}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void salvar();
          }
        }}
      />
      <ErroDoFormulario mensagem={erro} />
      <div className="flex flex-wrap justify-end gap-2">
        <Botao type="button" variante="fantasma" tamanho="sm" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
        <Botao type="button" variante="secundaria" tamanho="sm" onClick={() => void salvar()} disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar"}
        </Botao>
      </div>
    </div>
  );
}

/** Botão de texto "+ Nova …" logo abaixo do campo. */
export function BotaoDeAtalho({ children, disabled, aoClicar }: { children: string; disabled?: boolean; aoClicar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      disabled={disabled}
      className="mt-1 min-h-8 text-xs font-semibold text-accent hover:underline disabled:cursor-not-allowed disabled:text-ink-soft disabled:no-underline"
    >
      {children}
    </button>
  );
}

/**
 * Resposta da gravação pelo atalho. Gravou: a categoria devolvida entra na
 * lista e a opção nova é escolhida. Falhou: a lista é relida (se a rede caiu
 * depois de gravar, a opção aparece) e o erro fica no campo do atalho.
 */
export function respostaDoAtalho(
  r: ResultadoEstoque<CategoriaEstoque> | undefined,
  escolher: (categoria: CategoriaEstoque) => string | null,
  aoGravar: (categoria: CategoriaEstoque) => void,
  aoFalhar: () => void,
): ResultadoDoAtalho {
  if (!r) return { ok: false, erro: "Aguarde o envio em andamento." };
  if (!r.ok) {
    aoFalhar();
    return { ok: false, erro: mensagemDaFalha(r.falha) };
  }
  aoGravar(r.dados);
  const id = escolher(r.dados);
  return id ? { ok: true, id } : { ok: false, erro: "Gravado. Escolha a opção na lista." };
}
