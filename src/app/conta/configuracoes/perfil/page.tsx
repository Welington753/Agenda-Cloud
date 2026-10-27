"use client";

// Configurações → Perfil e segurança: o que antes ficava em "Minha conta".
// Quem está conectado, os estabelecimentos e papéis desta conta, a senha e
// a saída do sistema. Vale para todos os perfis, inclusive o funcionário e o
// administrador da plataforma sem estabelecimento.
import { KeyRound, LogOut, Store, UserRound } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { ROTULO_PAPEL_ESTABELECIMENTO_REAL } from "@/lib/auth/role-labels";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { useSair } from "@/components/conta/use-sair";
import { LinkAdministracao } from "@/components/administracao/acesso-administracao";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

export default function PerfilPage() {
  const { estado } = useRealAuth();
  const { saindo, sair } = useSair();
  if (estado.status !== "autenticado") return null;
  const { sessao, tenantIdAtivo } = estado;

  return (
    <PaginaConta titulo="Perfil e segurança" descricao="Sua identificação, seus acessos e a saída do sistema.">
      <Cartao>
        <CartaoCorpo className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <UserRound size={18} aria-hidden="true" className="text-ink-soft" />
            Identificação
          </h2>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]" data-testid="perfil-identificacao">
            <dt className="text-ink-soft">Nome</dt>
            <dd className="font-medium break-words text-ink">{sessao.user.name}</dd>
            <dt className="text-ink-soft">E-mail</dt>
            <dd className="font-medium break-words text-ink">{sessao.user.email}</dd>
          </dl>
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Store size={18} aria-hidden="true" className="text-ink-soft" />
            Acessos
          </h2>
          {sessao.contexts.length === 0 ? (
            <p className="text-sm text-ink-soft" data-testid="perfil-sem-estabelecimento">
              Sua conta não está vinculada a um estabelecimento.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="perfil-acessos">
              {sessao.contexts.map((contexto) => (
                <li key={contexto.tenantId} className="text-sm">
                  <span className="font-medium text-ink">{contexto.tenantName}</span>
                  <span className="text-ink-soft">
                    {" "}
                    · {ROTULO_PAPEL_ESTABELECIMENTO_REAL[contexto.role]}
                    {contexto.tenantId === tenantIdAtivo ? " · ativo agora" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <LinkAdministracao />
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <KeyRound size={18} aria-hidden="true" className="text-ink-soft" />
            Senha
          </h2>
          <p className="text-sm text-ink-soft" data-testid="perfil-senha">
            Para trocar a senha, peça a quem administra a plataforma um link de redefinição. O link vale
            por 24 horas e encerra as sessões abertas.
          </p>
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-soft">Encerrar a sessão neste aparelho.</p>
          <Botao
            variante="secundaria"
            onClick={() => void sair()}
            disabled={saindo}
            aria-busy={saindo}
            data-testid="perfil-sair"
          >
            <LogOut size={16} aria-hidden="true" />
            {saindo ? "Encerrando..." : "Encerrar sessão"}
          </Botao>
        </CartaoCorpo>
      </Cartao>
    </PaginaConta>
  );
}
