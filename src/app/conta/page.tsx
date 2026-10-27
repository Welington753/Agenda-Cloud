"use client";

// `/conta` não é mais uma página própria ("Minha conta" deixou de existir):
// ela só leva cada pessoa ao início do seu perfil. Identificação, senha e
// "Sair" ficam em Configurações → Perfil e segurança; o roteiro de primeiros
// passos, em Configurações → Estabelecimento.
//
// - dono: Início;
// - funcionário: Minha agenda;
// - sem área no estabelecimento ou sem estabelecimento: Administração, se o
//   servidor confirmar o acesso à plataforma; senão, Configurações.
//
// Continua sendo o destino depois do cadastro e de links antigos, por isso
// existe (sem conteúdo) em vez de um encaminhamento fixo no servidor, que não
// conhece o perfil.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { acessoConfirmado, useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { ROTA_ADMINISTRACAO } from "@/lib/administracao/rotas";
import { inicioDoPerfil, perfilDoPapel } from "@/lib/conta/papel";
import { ROTA_SELECIONAR_ESTABELECIMENTO } from "@/lib/conta/rotas";

export default function ContaPage() {
  const { estado } = useRealAuth();
  const { estado: acesso } = useAcessoPlataforma();
  const router = useRouter();

  const destino = (() => {
    if (estado.status !== "autenticado") return null;
    const { sessao, tenantIdAtivo } = estado;
    if (sessao.requiresTenantSelection && !tenantIdAtivo) return ROTA_SELECIONAR_ESTABELECIMENTO;
    const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;
    const perfil = perfilDoPapel(contexto?.role);
    if (contexto && perfil !== "sem-area") return inicioDoPerfil(perfil);
    // Sem área: espera a resposta do acesso à plataforma antes de escolher.
    if (acesso.status === "carregando") return null;
    return acessoConfirmado(acesso) ? ROTA_ADMINISTRACAO : inicioDoPerfil("sem-area");
  })();

  useEffect(() => {
    if (destino) router.replace(destino);
  }, [destino, router]);

  return (
    <p role="status" className="sr-only">
      Abrindo sua área…
    </p>
  );
}
