"use client";

import { Botao, LinkBotao } from "@/components/ui/button";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import type { LeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ROTA_ESTABELECIMENTOS_ADMINISTRADOS } from "@/lib/administracao/rotas";

const MENSAGENS = {
  sessao: "Sua sessão precisa ser verificada novamente.",
  permissao: "Sua conta não tem acesso à administração da plataforma.",
  ausente: "Estabelecimento não encontrado.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar os dados da administração.",
};

export function EstadoLeitura({
  estado,
  recarregar,
}: {
  estado: Exclude<LeituraPlataforma<unknown>, { status: "pronto" }>;
  recarregar: () => void;
}) {
  const { recarregar: verificarSessao } = useRealAuth();
  if (estado.status === "carregando")
    return (
      <p role="status" className="py-12 text-center text-ink-soft">
        Carregando administração…
      </p>
    );
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6">
      <p role="alert">{MENSAGENS[estado.motivo]}</p>
      {estado.motivo === "permissao" || estado.motivo === "ausente" ? (
        <LinkBotao
          href={
            estado.motivo === "ausente"
              ? ROTA_ESTABELECIMENTOS_ADMINISTRADOS
              : "/conta"
          }
          variante="secundaria"
        >
          Voltar
        </LinkBotao>
      ) : (
        <Botao
          onClick={() => {
            if (estado.motivo === "sessao") verificarSessao();
            recarregar();
          }}
        >
          Tentar novamente
        </Botao>
      )}
    </div>
  );
}
