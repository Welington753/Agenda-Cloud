"use client";

// Peças comuns das telas do Estoque: classes de campo, o aviso de recusa
// (sem adicional, sem permissão, falha), a moldura sem estabelecimento, a
// tabela que vira cartões no celular, o menu de ações e a janela de nome.
// Só tokens de cor: a estrutura é a mesma em todos os temas.
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Info, MoreHorizontal, PackageX, ShieldAlert, Store, type LucideIcon } from "lucide-react";
import type { FalhaEstoque } from "@/lib/api/estoque-api";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { ROTA_ESTOQUE_PRODUTOS } from "@/lib/conta/rotas";

export const CLASSE_CAMPO =
  "w-full rounded-[var(--radius-control)] border bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent disabled:opacity-60";
export const CLASSE_ROTULO = "block text-sm font-medium text-ink";
export const CLASSE_AJUDA = "mt-1 text-xs text-ink-soft";
export const CLASSE_ERRO_CAMPO = "mt-1 text-xs font-medium text-[color:var(--color-danger)]";

export function Campo({ rotulo, htmlFor, ajuda, erro, children }: { rotulo: string; htmlFor: string; ajuda?: string; erro?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className={CLASSE_ROTULO}>
        {rotulo}
      </label>
      <div className="mt-1.5">{children}</div>
      {erro ? (
        <p className={CLASSE_ERRO_CAMPO} role="alert">
          {erro}
        </p>
      ) : (
        ajuda && <p className={CLASSE_AJUDA}>{ajuda}</p>
      )}
    </div>
  );
}

/** Página sem estabelecimento ativo. */
export function SemEstabelecimento({ titulo }: { titulo: string }) {
  return (
    <PaginaConta titulo={titulo}>
      <Cartao>
        <CartaoCorpo className="flex items-start gap-3">
          <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
          <div>
            <p className="text-sm font-semibold text-ink">Sua conta ainda não está vinculada a um estabelecimento</p>
            <p className="mt-1 text-sm text-ink-soft">O estoque pertence a um estabelecimento.</p>
          </div>
        </CartaoCorpo>
      </Cartao>
    </PaginaConta>
  );
}

/** Recusa ou falha ao carregar a tela. Sem adicional e sem permissão não
 * oferecem "Tentar novamente" (não muda sem ação de outra pessoa). */
export function AvisoDeFalha({ falha, aoTentarDeNovo }: { falha: FalhaEstoque; aoTentarDeNovo?: () => void }) {
  const bloqueio = falha.tipo === "nao_contratado" || falha.tipo === "sem_permissao" || falha.tipo === "nao_encontrado";
  const Icone = falha.tipo === "nao_contratado" ? PackageX : ShieldAlert;
  return (
    <Cartao data-testid={`estoque-falha-${falha.tipo}`}>
      <CartaoCorpo className="flex items-start gap-3" role="alert">
        <Icone size={20} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden="true" />
        <div className="space-y-3">
          <p className="text-sm text-ink">{mensagemDaFalha(falha)}</p>
          {!bloqueio && aoTentarDeNovo && (
            <Botao variante="secundaria" tamanho="sm" onClick={aoTentarDeNovo}>
              Tentar novamente
            </Botao>
          )}
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}

/** Mensagem de erro dentro de um formulário. */
export function ErroDoFormulario({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null;
  return (
    <p className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-[color:var(--color-danger)]" role="alert">
      {mensagem}
    </p>
  );
}

/** Trilha das páginas do Estoque: "Estoque / <página>". */
export function trilhaDoEstoque(pagina: string) {
  return [{ rotulo: "Estoque", href: ROTA_ESTOQUE_PRODUTOS }, { rotulo: pagina }] as const;
}

/** Linha de apoio com ícone de informação, abaixo de cartões e tabelas. */
export function NotaInformativa({ children, destaque = false, ...props }: { children: ReactNode; destaque?: boolean } & Omit<HTMLAttributes<HTMLParagraphElement>, "className">) {
  return (
    <p
      className={clsx(
        "flex items-start gap-2 text-sm",
        destaque ? "rounded-[var(--radius-control)] bg-info-soft px-3 py-2.5 text-ink" : "text-ink-soft",
      )}
      {...props}
    >
      <Info size={16} className={clsx("mt-0.5 shrink-0", destaque ? "text-[color:var(--color-info)]" : "text-ink-soft")} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Tabela das telas do estoque. No computador, tabela comum; no celular, cada
 * linha vira um cartão (o cabeçalho some e cada célula leva o próprio rótulo,
 * via `RotuloNoCelular`). Uma só marcação: os dois formatos mostram os mesmos
 * elementos.
 */
export const TABELA = {
  tabela: "w-full border-collapse text-sm",
  cabecalho: "hidden bg-paper-muted text-left text-xs font-semibold text-ink-soft md:table-header-group",
  th: "px-4 py-3 font-semibold",
  corpo: "divide-y divide-border max-md:block",
  linha: "max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1.5 max-md:px-4 max-md:py-3",
  td: "align-middle md:px-4 md:py-3 max-md:block",
} as const;

export function RotuloNoCelular({ children }: { children: ReactNode }) {
  return <span className="mr-1 text-xs text-ink-soft md:hidden">{children}</span>;
}

export interface ItemDoMenu {
  rotulo: string;
  icone: LucideIcon;
  aoEscolher?: () => void;
  href?: string;
  perigo?: boolean;
  desabilitado?: boolean;
}

/** Botão "…" com as ações de uma linha. Fecha com Esc, clique fora ou escolha. */
export function MenuDeAcoes({ rotulo, itens }: { rotulo: string; itens: readonly ItemDoMenu[] }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  if (itens.length === 0) return null;
  const classeItem = (perigo?: boolean) =>
    clsx(
      "flex w-full items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-3 py-2 text-left text-sm hover:bg-paper-muted disabled:cursor-not-allowed disabled:opacity-50",
      perigo ? "text-[color:var(--color-danger)]" : "text-ink",
    );

  return (
    <div ref={caixa} className="relative inline-flex">
      <button
        type="button"
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className="inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] text-ink-soft hover:bg-paper-muted hover:text-ink"
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {aberto && (
        <div role="menu" aria-label={rotulo} className="absolute right-0 top-full z-30 mt-1 min-w-48 rounded-[var(--radius-control)] border border-border bg-card p-1 shadow-[var(--shadow-lift)]">
          {itens.map(({ rotulo: texto, icone: Icone, aoEscolher, href, perigo, desabilitado }) =>
            href ? (
              <Link key={texto} role="menuitem" href={href} className={classeItem(perigo)} onClick={() => setAberto(false)}>
                <Icone size={15} aria-hidden="true" /> {texto}
              </Link>
            ) : (
              <button
                key={texto}
                type="button"
                role="menuitem"
                disabled={desabilitado}
                className={classeItem(perigo)}
                onClick={() => {
                  setAberto(false);
                  aoEscolher?.();
                }}
              >
                <Icone size={15} aria-hidden="true" /> {texto}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Janela com um campo de nome (criar ou renomear categoria e subcategoria).
 * Enviar pelo Enter ou pelo botão; o erro da API aparece dentro dela.
 */
export function JanelaDeNome({
  aberta,
  titulo,
  rotulo,
  inicial,
  botao,
  gravando,
  erro,
  aoSalvar,
  aoFechar,
}: {
  aberta: boolean;
  titulo: string;
  rotulo: string;
  inicial: string;
  botao: string;
  gravando: boolean;
  erro: string | null;
  aoSalvar: (nome: string) => void;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState(inicial);
  useEffect(() => {
    if (aberta) setNome(inicial);
  }, [aberta, inicial]);
  const fechar = () => {
    if (!gravando) aoFechar();
  };
  return (
    <Modal
      aberto={aberta}
      aoFechar={fechar}
      titulo={titulo}
      rodape={
        <>
          <Botao variante="secundaria" onClick={fechar} disabled={gravando}>
            Cancelar
          </Botao>
          <Botao type="submit" form="janela-de-nome" disabled={gravando || !nome.trim()}>
            {gravando ? "Salvando…" : botao}
          </Botao>
        </>
      }
    >
      <form
        id="janela-de-nome"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (nome.trim()) aoSalvar(nome.trim());
        }}
      >
        <div>
          <label htmlFor="janela-de-nome-campo" className={CLASSE_ROTULO}>
            {rotulo}
          </label>
          <input id="janela-de-nome-campo" className={`${CLASSE_CAMPO} mt-1.5`} value={nome} maxLength={60} autoFocus onChange={(e) => setNome(e.target.value)} />
        </div>
        <ErroDoFormulario mensagem={erro} />
      </form>
    </Modal>
  );
}
