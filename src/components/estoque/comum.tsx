"use client";

// Peças comuns das telas do Estoque: classes de campo, o aviso de recusa
// (sem adicional, sem permissão, falha) e a moldura sem estabelecimento.
// Só tokens de cor: a estrutura é a mesma em todos os temas.
import type { ReactNode } from "react";
import { PackageX, ShieldAlert, Store } from "lucide-react";
import type { FalhaEstoque } from "@/lib/api/estoque-api";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { PaginaConta } from "@/components/conta/pagina-conta";

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
