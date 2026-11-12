"use client";

import { Botao, LinkBotao } from "@/components/ui/button";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import type { LeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ROTA_ESTABELECIMENTOS_ADMINISTRADOS } from "@/lib/administracao/rotas";

const MENSAGENS = {
  sessao: "Sua sessão precisa ser verificada novamente.",
  permissao: "Sua conta não tem acesso ao portal da plataforma.",
  ausente: "Estabelecimento não encontrado.",
  recusado: "O servidor recusou esta consulta. Ele pode ainda não aceitar este filtro.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar os dados da administração.",
};

/** Motivo da tela; `recusado` é a recusa 400 (consulta não aceita). */
type Motivo = Extract<LeituraPlataforma<unknown>, { status: "erro" }>["motivo"] | "recusado";

/** `mensagens` troca o texto de um motivo na tela que sabe o que ele
 * significa ali (por exemplo, 404 de uma rota que a API anterior não tem). */
export function EstadoLeitura({
  estado,
  recarregar,
  mensagens,
}: {
  estado: Exclude<LeituraPlataforma<unknown>, { status: "pronto" }>;
  recarregar: () => void;
  mensagens?: Partial<Record<Motivo, string>>;
}) {
  const { recarregar: verificarSessao } = useRealAuth();
  if (estado.status === "carregando")
    return (
      <p role="status" className="py-12 text-center text-ink-soft">
        Carregando o portal…
      </p>
    );
  const motivo: Motivo = estado.codigo === 400 ? "recusado" : estado.motivo;
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6">
      <p role="alert">{mensagens?.[motivo] ?? MENSAGENS[motivo]}</p>
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
