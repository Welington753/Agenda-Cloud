"use client";

// Ficha de uma conta: dados, situação, administração da plataforma,
// estabelecimentos com o acesso efetivo e o acesso por e-mail. Cada botão só
// aparece se o servidor disse que esta conta pode usá-lo (`allowedActions`),
// e o servidor confere de novo em cada operação.
import Link from "next/link";
import { useParams } from "next/navigation";
import { Botao } from "@/components/ui/button";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { SecaoDados } from "@/components/administracao/ficha-usuario/secao-dados";
import { SecaoPlataforma } from "@/components/administracao/ficha-usuario/secao-plataforma";
import { SecaoVinculos } from "@/components/administracao/ficha-usuario/secao-vinculos";
import { SecaoAcesso } from "@/components/administracao/ficha-usuario/secao-acesso";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehFichaUsuario } from "@/lib/administracao/contas";
import { ROTA_HISTORICO, ROTA_USUARIOS } from "@/lib/administracao/rotas";

export default function FichaUsuarioPage() {
  const { id } = useParams<{ id: string }>();
  const { estado, recarregar, anterior } = useLeituraPlataforma(`/platform/users/${encodeURIComponent(id)}`, ehFichaUsuario);
  // Enquanto relê depois de uma ação, a ficha anterior continua na tela.
  const ficha = estado.status === "pronto" ? estado.dados : anterior;
  if (!ficha) return estado.status !== "pronto" && <EstadoLeitura estado={estado} recarregar={recarregar} />;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={ROTA_USUARIOS} className="inline-flex min-h-11 items-center text-sm font-medium text-accent">
            ← Usuários
          </Link>
          <h1 className="break-words text-2xl font-bold">{ficha.name}</h1>
          <p className="break-all text-sm text-ink-soft">{ficha.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`${ROTA_HISTORICO}?targetUserId=${encodeURIComponent(ficha.id)}`}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border px-4 text-sm font-semibold"
          >
            Histórico desta conta
          </Link>
          <Botao variante="secundaria" onClick={recarregar} className="min-h-11">
            Atualizar
          </Botao>
        </div>
      </header>
      {/* `key` com o updatedAt: depois de salvar, os campos voltam a refletir
          o que está no servidor. */}
      <SecaoDados key={`dados-${ficha.updatedAt}`} ficha={ficha} aoMudar={recarregar} />
      <SecaoVinculos ficha={ficha} aoMudar={recarregar} />
      <SecaoPlataforma key={`plataforma-${ficha.updatedAt}`} ficha={ficha} aoMudar={recarregar} />
      <SecaoAcesso ficha={ficha} aoMudar={recarregar} />
    </div>
  );
}
