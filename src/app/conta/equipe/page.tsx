"use client";

// "Equipe e acessos" — o dono dá a cada profissional do estabelecimento um
// login próprio, limitado pelo plano. Aproveita o cadastro de Profissionais:
// nada é cadastrado duas vezes; o acesso é ligado ao profissional que já
// existe.
//
// O servidor conta as vagas e decide tudo (GET /tenants/:id/team): esta tela
// mostra os números dele, nunca uma conta feita no navegador.
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehVisaoDaEquipe, textoDasVagas } from "@/lib/equipe/contratos";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { ReautenticacaoProvider } from "@/components/administracao/reautenticacao";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MembroEquipe } from "./membro-equipe";

const MENSAGEM_DE_LEITURA = {
  sessao: "Sua sessão precisa ser verificada novamente. Entre de novo.",
  permissao: "Sua conta não pode gerenciar a equipe deste estabelecimento.",
  ausente: "Estabelecimento não encontrado.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar a equipe.",
} as const;

export default function EquipePage() {
  const { estado: sessao } = useRealAuth();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const { estado, recarregar, anterior } = useLeituraPlataforma(
    tenantId ? `/tenants/${encodeURIComponent(tenantId)}/team` : null,
    ehVisaoDaEquipe,
  );
  // Enquanto relê (depois de uma ação), mantém a lista anterior na tela.
  const visao = estado.status === "pronto" ? estado.dados : anterior;
  if (sessao.status !== "autenticado") return null;

  return (
    <ReautenticacaoProvider>
      <PaginaConta
        titulo="Equipe e acessos"
        descricao="Um login para cada profissional, limitado pelo plano. Cada pessoa vê só a própria agenda e o que você liberar."
        acoes={
          <Botao type="button" variante="secundaria" className="min-h-11" onClick={recarregar}>
            <RefreshCw size={16} aria-hidden="true" />
            Atualizar
          </Botao>
        }
      >
        {!tenantId && (
          <Cartao>
            <CartaoCorpo>
              <p className="text-sm text-ink">
                Escolha um estabelecimento para ver a equipe dele.
              </p>
            </CartaoCorpo>
          </Cartao>
        )}
        {tenantId && !visao && estado.status === "carregando" && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {!visao && estado.status === "erro" && (
          <Cartao>
            <CartaoCorpo className="space-y-3">
              <p role="alert" className="text-sm text-ink">
                {MENSAGEM_DE_LEITURA[estado.motivo]}
              </p>
              {(estado.motivo === "rede" || estado.motivo === "servidor") && (
                <Botao type="button" onClick={recarregar}>
                  Tentar novamente
                </Botao>
              )}
            </CartaoCorpo>
          </Cartao>
        )}
        {visao && (
          <>
            <Cartao>
              <CartaoCorpo className="space-y-3">
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-soft">Acessos de funcionário</dt>
                    <dd className="mt-1 text-sm font-semibold text-ink" data-testid="vagas-equipe">
                      {textoDasVagas(visao.seats)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-soft">Vagas livres</dt>
                    <dd className="mt-1 text-sm font-semibold text-ink" data-testid="vagas-livres">
                      {visao.seats.available}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-soft">Profissionais ativos</dt>
                    <dd className="mt-1 text-sm font-semibold text-ink">
                      {visao.professionals.active} de {visao.professionals.limit} · plano {visao.plan.name}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-ink-soft">
                  O plano permite {visao.plan.maxProfessionals} profissional(is) e o mesmo número de acessos de
                  funcionário. Ocupam vaga os acessos ativos e os convites pendentes; seu acesso de dono(a) não ocupa.
                  Revogar um convite, deixar vencer, suspender ou remover um acesso libera a vaga.
                  {visao.seats.suspendedAccesses > 0 &&
                    ` ${visao.seats.suspendedAccesses} acesso(s) suspenso(s) não ocupa(m) vaga agora; reativar depende de haver vaga.`}
                </p>
              </CartaoCorpo>
            </Cartao>

            {visao.members.length === 0 ? (
              <Cartao>
                <CartaoCorpo className="space-y-2 text-sm">
                  <p className="font-semibold text-ink">Nenhum profissional cadastrado</p>
                  <p className="text-ink-soft">
                    Cada acesso fica ligado a um profissional. Cadastre primeiro em{" "}
                    <Link href="/conta/profissionais" className="font-medium text-accent hover:underline">
                      Profissionais
                    </Link>
                    .
                  </p>
                </CartaoCorpo>
              </Cartao>
            ) : (
              <ul className="space-y-3" data-testid="lista-equipe">
                {visao.members.map((m) => (
                  <MembroEquipe
                    // A chave inclui o estado do acesso: depois de uma ação, as
                    // permissões marcadas voltam a ser as do servidor.
                    key={`${m.professional.id}:${m.situation}:${m.access?.grantedPermissions.join(",") ?? ""}:${m.invite?.id ?? ""}`}
                    membro={m}
                    visao={visao}
                    aoMudar={recarregar}
                  />
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-soft">
              Para cadastrar, editar ou desativar profissionais, use{" "}
              <Link href="/conta/profissionais" className="font-medium text-accent hover:underline">
                Profissionais
              </Link>
              . Desativar um profissional interrompe o acesso ligado a ele e preserva as reservas.
            </p>
          </>
        )}
      </PaginaConta>
    </ReautenticacaoProvider>
  );
}
