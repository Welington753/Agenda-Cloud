"use client";

// Moldura das subpáginas de Configurações: só o conteúdo da seção escolhida,
// com um retorno discreto ao índice acima do título. Não há menu das seções
// ao lado nem abas: para trocar de seção, volta-se ao índice (ou usa-se o
// submenu de Configurações no menu lateral, no computador).
//
// Ficam de fora:
// - o próprio índice, que já é a lista das seções;
// - Serviços e Profissionais, que moram sob `/conta/configuracoes` (endereços
//   mantidos) mas são áreas próprias do menu;
// - a troca obrigatória de senha: com senha temporária, Perfil e segurança é
//   a única tela, e um link para o índice só levaria de volta a ela.
//
// Cada subpágina continua sendo a tela que já existia, com as mesmas
// leituras e regras.
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { ROTA_CONFIGURACOES, emAreaSobConfiguracoes } from "@/lib/conta/rotas";

export default function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { estado } = useRealAuth();
  const caminho = (pathname ?? "").replace(/\/+$/, "");
  const trocaObrigatoria = estado.status === "autenticado" && estado.sessao.user.mustChangePassword === true;

  const comRetorno = caminho !== ROTA_CONFIGURACOES && !emAreaSobConfiguracoes(caminho) && !trocaObrigatoria;

  // A mesma árvore com ou sem o retorno: ao terminar a troca obrigatória, a
  // página de Perfil não pode remontar (perderia o encaminhamento ao início).
  return (
    <div className={comRetorno ? "mx-auto w-full max-w-5xl" : undefined}>
      {comRetorno && (
        <Link
          href={ROTA_CONFIGURACOES}
          data-testid="voltar-configuracoes"
          className="-mt-2 mb-1 inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--color-accent-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeft size={14} className="mr-1" aria-hidden="true" />
          Configurações
        </Link>
      )}
      {children}
    </div>
  );
}
