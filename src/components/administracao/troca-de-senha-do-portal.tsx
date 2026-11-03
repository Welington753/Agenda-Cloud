"use client";

// Troca obrigatória da senha temporária DENTRO do portal da plataforma: o
// proprietário conclui o primeiro acesso sem passar pela operação e sem
// estabelecimento nenhum. É a mesma troca da operação (`TrocarSenha`,
// `POST /auth/password`): mesma política de senha, a exigência de troca
// limpa no servidor e as OUTRAS sessões da conta encerradas; papel e
// vínculos não mudam.
//
// Enquanto a sessão pedir a troca, o portal mostra só esta tela: o menu não
// aparece e nenhum dado do portal é pedido para exibição. O servidor recusa
// `/platform/*` com `TROCA_DE_SENHA_OBRIGATORIA` até a troca, com ou sem tela.
// Depois dela, relê a sessão e o acesso e segue para um destino de dentro do
// portal (a página aberta, ou a lista de estabelecimentos se era a entrada).
import { KeyRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { destinoNoPortal } from "@/lib/administracao/rotas";
import { TrocarSenha } from "@/components/auth/trocar-senha";
import { useToast } from "@/components/ui/toast";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

export function TrocaDeSenhaDoPortal() {
  const { recarregar: recarregarSessao } = useRealAuth();
  const { recarregar: recarregarAcesso } = useAcessoPlataforma();
  const { notificar } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  function aoTrocar() {
    notificar("Senha trocada. As outras sessões desta conta foram encerradas.", "sucesso");
    recarregarSessao();
    recarregarAcesso();
    router.replace(destinoNoPortal(pathname ? `${pathname}${window.location.search}` : null));
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4" data-testid="portal-troca-de-senha">
      <h1 className="text-2xl font-bold text-ink">Escolha a sua senha</h1>
      <Cartao>
        <CartaoCorpo className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <KeyRound size={18} aria-hidden="true" className="text-ink-soft" />
            Senha
          </h2>
          <TrocarSenha obrigatoria aoTrocar={aoTrocar} bloqueadas="os dados e as ações do portal" />
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}
