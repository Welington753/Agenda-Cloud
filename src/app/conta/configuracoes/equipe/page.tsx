"use client";

// "Equipe e acessos" — o dono cria, com login e senha, o acesso de cada
// pessoa da equipe: Profissional (ligado ao cadastro de um profissional) ou
// Gerente (com ou sem profissional, com as áreas que o dono conceder). Sem
// convite e sem e-mail. Limitado pelo plano. O acesso do dono continua o de
// sempre, pelo e-mail comprovado.
//
// O servidor conta as vagas e decide tudo (GET /tenants/:id/team): esta tela
// mostra os números dele, nunca uma conta feita no navegador.
import { useState } from "react";
import Link from "next/link";
import { RefreshCw, UserPlus } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import {
  ehVisaoDaEquipe,
  textoDasVagas,
  type AcessoNaLista,
  type MembroDaEquipe,
  type VisaoDaEquipe,
} from "@/lib/equipe/contratos";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { ReautenticacaoProvider } from "@/components/administracao/reautenticacao";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AcessoEquipe } from "./acesso-equipe";
import { ConviteAntigo } from "./convite-antigo";
import { CriarAcesso } from "./criar-acesso";

const MENSAGEM_DE_LEITURA = {
  sessao: "Sua sessão precisa ser verificada novamente. Entre de novo.",
  permissao: "Sua conta não pode gerenciar a equipe deste estabelecimento.",
  ausente: "Estabelecimento não encontrado.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar a equipe.",
} as const;

/** Acessos da equipe. Numa API anterior (sem `accesses`), os ligados a
 * profissionais. */
function acessosDa(visao: VisaoDaEquipe): AcessoNaLista[] {
  if (visao.accesses) return visao.accesses;
  return visao.members
    .filter((m) => m.access && !m.access.isOwner)
    .map((m) => ({ ...m.access!, professional: m.professional, situation: m.situation }));
}

export default function EquipePage() {
  const { estado: sessao } = useRealAuth();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const { estado, recarregar, anterior } = useLeituraPlataforma(
    tenantId ? `/tenants/${encodeURIComponent(tenantId)}/team` : null,
    ehVisaoDaEquipe,
  );
  const [criando, setCriando] = useState<{ profissional?: string } | null>(null);
  // Enquanto relê (depois de uma ação), mantém a lista anterior na tela.
  const visao = estado.status === "pronto" ? estado.dados : anterior;
  if (sessao.status !== "autenticado") return null;

  const acessos = visao ? acessosDa(visao) : [];
  const convites = visao
    ? visao.members.filter((m): m is MembroDaEquipe & { invite: NonNullable<MembroDaEquipe["invite"]> } => !!m.invite)
    : [];
  const livres = visao
    ? visao.members.filter((m) => m.professional.active && m.situation === "NO_ACCESS").map((m) => m.professional)
    : [];
  const semVaga = !!visao && visao.seats.available === 0;

  return (
    <ReautenticacaoProvider>
      <PaginaConta
        titulo="Equipe e acessos"
        descricao="Crie o login de cada pessoa da equipe e escolha o que ela pode fazer. Sem convite e sem e-mail."
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
              <p className="text-sm text-ink">Escolha um estabelecimento para ver a equipe dele.</p>
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
                    <dt className="text-xs text-ink-soft">Acessos da equipe</dt>
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
                  O plano permite {visao.plan.maxProfessionals} acesso(s) de equipe, entre profissionais e gerentes. Seu
                  acesso de dono(a) não ocupa vaga. Um gerente sem profissional ocupa vaga de acesso, mas não conta como
                  profissional. Suspender ou remover um acesso libera a vaga.
                  {visao.seats.suspendedAccesses > 0 &&
                    ` ${visao.seats.suspendedAccesses} acesso(s) suspenso(s) não ocupa(m) vaga agora; reativar depende de haver vaga.`}
                </p>
                {!criando && (
                  <div className="space-y-1">
                    <Botao type="button" className="min-h-11" disabled={semVaga} onClick={() => setCriando({})}>
                      <UserPlus size={16} aria-hidden="true" />
                      Criar acesso
                    </Botao>
                    {semVaga && (
                      <p className="text-xs text-ink-soft">
                        Sem vaga no plano para outro acesso. Suspenda ou remova um acesso, revogue um convite antigo ou
                        troque o plano.
                      </p>
                    )}
                  </div>
                )}
              </CartaoCorpo>
            </Cartao>

            {criando && (
              <CriarAcesso
                // Remonta a cada abertura: chave de formulário nova.
                key={criando.profissional ?? "novo"}
                visao={visao}
                profissionaisLivres={livres}
                profissionalInicial={criando.profissional}
                aoCancelar={() => setCriando(null)}
                aoConcluir={() => {
                  setCriando(null);
                  recarregar();
                }}
              />
            )}

            <section aria-labelledby="titulo-acessos" className="space-y-3">
              <h2 id="titulo-acessos" className="text-base font-semibold text-ink">
                Acessos
              </h2>
              {acessos.length === 0 ? (
                <p className="text-sm text-ink-soft">Nenhum acesso da equipe ainda. Use “Criar acesso”.</p>
              ) : (
                <ul className="space-y-3" data-testid="lista-equipe">
                  {acessos.map((a) => (
                    <AcessoEquipe
                      // A chave inclui o estado do acesso: depois de uma ação,
                      // as permissões marcadas voltam a ser as do servidor.
                      key={`${a.membershipId}:${a.role}:${a.professional?.id ?? ""}:${a.situation}:${a.grantedPermissions.join(",")}`}
                      acesso={a}
                      visao={visao}
                      profissionaisLivres={livres}
                      aoMudar={recarregar}
                    />
                  ))}
                </ul>
              )}
            </section>

            {convites.length > 0 && (
              <section aria-labelledby="titulo-convites" className="space-y-3">
                <h2 id="titulo-convites" className="text-base font-semibold text-ink">
                  Convites por e-mail ainda pendentes
                </h2>
                <p className="text-sm text-ink-soft">
                  Enviados antes do acesso por login e senha. Continuam valendo até vencer e ocupam vaga. Reenvie ou
                  revogue; para dar acesso sem e-mail, revogue e crie o acesso.
                </p>
                <ul className="space-y-3">
                  {convites.map((m) => (
                    <ConviteAntigo key={`${m.invite.id}:${m.invite.sendCount}`} membro={m} visao={visao} aoMudar={recarregar} />
                  ))}
                </ul>
              </section>
            )}

            {livres.length > 0 && (
              <section aria-labelledby="titulo-sem-acesso" className="space-y-2">
                <h2 id="titulo-sem-acesso" className="text-base font-semibold text-ink">
                  Profissionais sem acesso
                </h2>
                <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-card">
                  {livres.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2" data-testid="profissional-sem-acesso">
                      <span className="min-w-0 break-words text-sm text-ink">{p.name}</span>
                      <Botao
                        type="button"
                        variante="secundaria"
                        className="min-h-11"
                        disabled={semVaga}
                        onClick={() => setCriando({ profissional: p.id })}
                      >
                        Criar acesso
                        <span className="sr-only"> para {p.name}</span>
                      </Botao>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-xs text-ink-soft">
              Para cadastrar, editar ou desativar profissionais, use{" "}
              <Link href="/conta/configuracoes/profissionais" className="font-medium text-accent hover:underline">
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
