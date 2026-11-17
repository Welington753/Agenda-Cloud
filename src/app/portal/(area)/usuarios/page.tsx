"use client";

// Contas e acessos: responsáveis pelos estabelecimentos e contas
// administrativas da plataforma, em abas separadas. Cada aba é um conjunto
// próprio no servidor (`scope`): busca, situação, páginas e totais nunca
// misturam as duas. Funcionários ficam em "Equipe e acessos", na conta de
// cada estabelecimento; clientes da agenda não são contas daqui.
//
// A aba de administradores só aparece com `managePlatformAccess` confirmado
// pelo servidor, e a API recusa a lista para quem não o tem: esconder aqui é
// só apresentação. Endereço mantido (`/portal/usuarios`); a aba vai em
// `?aba=administradores`.
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { LockKeyhole, Plus, Store, UserRound, Users, type LucideIcon } from "lucide-react";
import { LinkBotao } from "@/components/ui/button";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import {
  AcaoDaConta,
  AtualizarContas,
  CELULA,
  FiltrosDasContas,
  LINHA,
  PaginacaoDasContas,
  ROTULO_CELULA,
  ResumoDasContas,
  SemContas,
  SituacaoDaConta,
  TabelaDeContas,
  useListaDaAba,
} from "@/components/administracao/contas-e-acessos";
import { useCapacidades } from "@/lib/administracao/use-acesso-plataforma";
import {
  abaDaUrl,
  ehListaAdministradores,
  ehListaResponsaveis,
  perfilAdministrativo,
  tituloDaLista,
  type AbaContas,
  type ContaAdministrativa,
  type ContaResponsavel,
} from "@/lib/administracao/contas-e-acessos";
import { ROTA_ESTABELECIMENTOS_ADMINISTRADOS, ROTA_PAPEIS, rotaContasEAcessos } from "@/lib/administracao/rotas";

export default function ContasEAcessosPage() {
  return (
    <Suspense fallback={<p className="py-12 text-center text-ink-soft">Carregando o portal…</p>}>
      <ContasEAcessos />
    </Suspense>
  );
}

function ContasEAcessos() {
  const capacidades = useCapacidades();
  const busca = useSearchParams();
  const podeVerAdministradores = capacidades.managePlatformAccess;
  const aba = abaDaUrl(busca.get("aba"), podeVerAdministradores);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Contas e acessos</h1>
        <p className="mt-1 max-w-xl text-sm text-ink-soft">
          Organize o acesso dos seus clientes e da sua equipe de administração.
        </p>
      </header>
      {podeVerAdministradores && (
        <nav aria-label="Tipo de conta" className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-paper-muted p-1">
          <AbaLink aba="estabelecimentos" atual={aba} icone={Store} rotulo="Contas dos estabelecimentos" />
          <AbaLink aba="administradores" atual={aba} icone={LockKeyhole} rotulo="Administradores do sistema" />
        </nav>
      )}
      {/* `key`: trocar de aba começa a busca do zero. */}
      {aba === "administradores" ? <ListaAdministradores key="adm" /> : <ListaResponsaveis key="est" />}
    </div>
  );
}

function AbaLink({ aba, atual, icone: Icone, rotulo }: { aba: AbaContas; atual: AbaContas; icone: LucideIcon; rotulo: string }) {
  const ativa = aba === atual;
  return (
    <Link
      href={rotaContasEAcessos(aba)}
      aria-current={ativa ? "page" : undefined}
      className={clsx(
        "flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-sm font-semibold",
        ativa ? "bg-accent text-on-accent shadow-sm" : "text-ink-soft hover:bg-card hover:text-ink",
      )}
    >
      <Icone size={18} aria-hidden="true" className="hidden shrink-0 sm:block" />
      {rotulo}
    </Link>
  );
}

function ListaResponsaveis() {
  const lista = useListaDaAba<ContaResponsavel>("estabelecimentos", ehListaResponsaveis);
  const capacidades = useCapacidades();
  const { estado } = lista;
  return (
    <>
      <div className="flex justify-end">
        <AtualizarContas recarregar={lista.recarregar} />
      </div>
      {estado.status === "pronto" && <ResumoDasContas resumo={estado.dados.summary} rotuloTotal="Contas de clientes" />}
      <FiltrosDasContas lista={lista} rotuloBusca="Estabelecimento, responsável ou e-mail" />
      {estado.status !== "pronto" ? (
        <EstadoLeitura estado={estado} recarregar={lista.recarregar} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 role="status" className="text-lg font-semibold">
              {tituloDaLista("estabelecimentos", estado.dados.total)}
            </h2>
            {capacidades.manageEstablishments && (
              <div className="flex flex-col gap-1 sm:items-end">
                <LinkBotao href={ROTA_ESTABELECIMENTOS_ADMINISTRADOS} className="min-h-11" aria-describedby="dica-convidar">
                  <Plus size={17} aria-hidden="true" />
                  Convidar responsável
                </LinkBotao>
                <span id="dica-convidar" className="text-xs text-ink-soft">
                  O convite é feito no estabelecimento (ou ao criar um novo).
                </span>
              </div>
            )}
          </div>
          {estado.dados.items.length === 0 ? (
            <SemContas />
          ) : (
            <TabelaDeContas testId="lista-contas" colunas={["Estabelecimento", "Responsável", "Situação da conta", "Ações"]}>
              {estado.dados.items.map((c) => (
                <tr key={c.id} className={LINHA}>
                  <td className={CELULA}>
                    <span className={ROTULO_CELULA}>Estabelecimento:</span>
                    <ul className="inline md:block md:space-y-1">
                      {c.establishments.map((e) => (
                        <li key={e.tenantId} className="flex items-center gap-2 font-semibold">
                          <Store size={18} aria-hidden="true" className="hidden shrink-0 text-accent md:block" />
                          <span className="break-words">{e.tenantName}</span>
                          {e.relation === "PENDING_INVITE" && <span className="shrink-0 text-xs font-normal text-ink-soft">(convite)</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className={CELULA}>
                    <span className={ROTULO_CELULA}>Responsável:</span>
                    <span className="font-semibold">{c.name}</span>
                    <span className="block break-all text-ink-soft">{c.email}</span>
                  </td>
                  <SituacaoDaConta status={c.status} />
                  <AcaoDaConta conta={c} />
                </tr>
              ))}
            </TabelaDeContas>
          )}
          <PaginacaoDasContas lista={lista} total={estado.dados.total} pageSize={estado.dados.pageSize} />
        </>
      )}
      <p className="flex items-start gap-2 rounded-xl bg-accent-soft p-4 text-sm text-ink-soft">
        <Users size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        Funcionários são gerenciados pelo dono em Equipe e acessos, na conta do estabelecimento.
      </p>
    </>
  );
}

function ListaAdministradores() {
  const lista = useListaDaAba<ContaAdministrativa>("administradores", ehListaAdministradores);
  const { estado } = lista;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          Acesso exclusivo aos proprietários da plataforma.{" "}
          <Link href={ROTA_PAPEIS} className="font-medium text-accent">
            O que cada papel pode fazer
          </Link>
        </p>
        <AtualizarContas recarregar={lista.recarregar} />
      </div>
      {estado.status === "pronto" && <ResumoDasContas resumo={estado.dados.summary} rotuloTotal="Administradores" />}
      <FiltrosDasContas lista={lista} rotuloBusca="Nome ou e-mail" />
      {estado.status !== "pronto" ? (
        <EstadoLeitura estado={estado} recarregar={lista.recarregar} />
      ) : (
        <>
          <h2 role="status" className="text-lg font-semibold">
            {tituloDaLista("administradores", estado.dados.total)}
          </h2>
          {estado.dados.items.length === 0 ? (
            <SemContas />
          ) : (
            <TabelaDeContas testId="lista-administradores" colunas={["Administrador", "Perfil", "Situação", "Ações"]}>
              {estado.dados.items.map((c) => (
                <tr key={c.id} className={LINHA}>
                  <td className={CELULA}>
                    <span className="inline-flex items-center gap-2 font-semibold">
                      <UserRound size={18} aria-hidden="true" className="shrink-0 text-accent" />
                      {c.name}
                    </span>
                    <span className="block break-all text-ink-soft">{c.email}</span>
                  </td>
                  <td className={CELULA}>
                    <span className={ROTULO_CELULA}>Perfil:</span>
                    {perfilAdministrativo(c.platformRole)}
                  </td>
                  <SituacaoDaConta status={c.status} />
                  <AcaoDaConta conta={c} />
                </tr>
              ))}
            </TabelaDeContas>
          )}
          <PaginacaoDasContas lista={lista} total={estado.dados.total} pageSize={estado.dados.pageSize} />
        </>
      )}
    </>
  );
}
