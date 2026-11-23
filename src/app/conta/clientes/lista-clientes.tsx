"use client";

// Lista de clientes da tela de Clientes, AGRUPADA por telefone: um estado
// visual para cada situação — carregando, falha (com ou sem permissão),
// nenhum cliente cadastrado, nenhum resultado para a busca e a lista em si,
// com "Carregar mais" enquanto o servidor tiver outra página. O total é o do
// servidor.
//
// Um grupo com mais de um cadastro abre em seções ("Mesmo WhatsApp" e
// "Número parecido"). Cada nome leva à própria ficha; nenhum total é somado
// entre cadastros, e nada é unificado daqui.
import Link from "next/link";
import { Mail, MessageCircle, UserPlus, UserRound, Users } from "lucide-react";
import type { MembroDoGrupo } from "@/lib/api/consumers-api";
import { mensagemFalhaBusca } from "@/lib/clientes/cadastro";
import { avisoDeMesmoNome, secoesDoGrupo, textoDoTotalDeGrupos } from "@/lib/clientes/ficha";
import { rotaDaFichaDoCliente } from "@/lib/conta/rotas";
import type { EstadoListaClientes } from "@/lib/clientes/use-clientes-reais";
import { Botao } from "@/components/ui/button";
import { LinkWhatsappCliente } from "@/components/conta/contato-whatsapp";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface ListaClientesProps {
  lista: EstadoListaClientes;
  /** Id do cliente recém-cadastrado, para destacá-lo na lista. */
  destacadoId: string | null;
  aoRepetir: () => void;
  aoCarregarMais: () => void;
  aoLimparBusca: () => void;
  aoCadastrar: (() => void) | null;
}

/** Um cadastro: nome com link para a ficha, contato e o aviso de mesmo nome. */
function LinhaDoCliente({ cliente }: { cliente: MembroDoGrupo }) {
  const aviso = avisoDeMesmoNome(cliente.mesmoNome);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid="cliente-da-lista">
      <div className="min-w-0 space-y-1">
        <Link
          href={rotaDaFichaDoCliente(cliente.id)}
          className="min-w-0 font-semibold break-words text-ink underline-offset-2 hover:underline"
          data-testid="cliente-ficha-link"
        >
          {cliente.name}
        </Link>
        <div className="flex min-w-0 flex-col gap-1 text-sm text-ink-soft sm:flex-row sm:gap-4">
          <span className="inline-flex items-center gap-1.5">
            <MessageCircle size={14} aria-hidden="true" />
            {cliente.whatsapp}
          </span>
          {cliente.email && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Mail size={14} aria-hidden="true" className="shrink-0" />
              <span className="break-all">{cliente.email}</span>
            </span>
          )}
        </div>
        {aviso && (
          <Link
            href={rotaDaFichaDoCliente(cliente.id)}
            className="inline-block text-xs font-medium text-[color:var(--color-accent-hover)] underline"
            data-testid="aviso-mesmo-nome"
          >
            {aviso}
          </Link>
        )}
      </div>
      <LinkWhatsappCliente nome={cliente.name} telefone={cliente.whatsapp} className="self-start sm:self-auto" />
    </div>
  );
}

export function ListaClientes({
  lista,
  destacadoId,
  aoRepetir,
  aoCarregarMais,
  aoLimparBusca,
  aoCadastrar,
}: ListaClientesProps) {
  if (lista.status === "carregando") {
    return (
      <div className="space-y-3" aria-busy="true" data-testid="clientes-buscando">
        <p role="status" className="text-sm text-ink-soft">
          {lista.termo ? `Buscando “${lista.termo}”...` : "Carregando clientes..."}
        </p>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (lista.status === "falha") {
    const semPermissao = lista.falha.tipo === "sem_permissao" || lista.falha.tipo === "sem_acesso";
    return (
      <Cartao>
        <CartaoCorpo className="space-y-3" data-testid={semPermissao ? "clientes-sem-permissao" : "clientes-falha"}>
          <p role="alert" className="text-sm text-ink">
            {mensagemFalhaBusca(lista.falha)}
          </p>
          {!semPermissao && (
            <Botao type="button" onClick={aoRepetir}>
              Tentar novamente
            </Botao>
          )}
        </CartaoCorpo>
      </Cartao>
    );
  }

  const acaoCadastrar = aoCadastrar ? (
    <Botao type="button" onClick={aoCadastrar}>
      <UserPlus size={16} aria-hidden="true" />
      Cadastrar cliente
    </Botao>
  ) : undefined;

  if (lista.total === 0 && !lista.termo) {
    return (
      <div data-testid="clientes-vazio">
        <EstadoVazio
          icone={Users}
          titulo="Nenhum cliente cadastrado ainda"
          descricao="Cadastre o primeiro cliente aqui ou crie um agendamento na Agenda."
          acao={acaoCadastrar}
        />
      </div>
    );
  }

  if (lista.grupos.length === 0) {
    return (
      <div data-testid="clientes-nenhum">
        <EstadoVazio
          icone={UserRound}
          titulo={`Nenhum cliente encontrado para “${lista.termo}”`}
          descricao="Confira a grafia ou tente parte do nome ou do WhatsApp."
          acao={
            <div className="flex flex-wrap justify-center gap-2">
              <Botao type="button" variante="secundaria" onClick={aoLimparBusca}>
                Ver todos os clientes
              </Botao>
              {acaoCadastrar}
            </div>
          }
        />
      </div>
    );
  }

  return (
    <section aria-labelledby="titulo-resultados" className="space-y-3">
      <h2 id="titulo-resultados" className="text-sm font-semibold text-ink" role="status" data-testid="clientes-total">
        {textoDoTotalDeGrupos(lista.total, lista.termo)}
      </h2>
      <ul className="space-y-2" data-testid="lista-clientes">
        {lista.grupos.map((grupo) => {
          const secoes = secoesDoGrupo(grupo);
          const destacado = grupo.membros.some((m) => m.id === destacadoId);
          return (
            <li key={grupo.chave}>
              <Cartao className={destacado ? "ring-1 ring-accent" : undefined}>
                <CartaoCorpo>
                  {secoes.length === 0 ? (
                    <LinhaDoCliente cliente={grupo.membros[0]} />
                  ) : (
                    <details open={destacado || undefined} data-testid="grupo-clientes">
                      <summary className="cursor-pointer text-sm font-semibold text-ink">
                        {grupo.membros.length} cadastros com WhatsApp igual ou parecido — confira
                      </summary>
                      <div className="mt-3 space-y-4">
                        {secoes.map((secao) => (
                          <section key={secao.titulo} className="space-y-3" data-testid="secao-grupo">
                            <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">{secao.titulo}</h3>
                            <ul className="space-y-3">
                              {secao.membros.map((membro) => (
                                <li key={membro.id}>
                                  <LinhaDoCliente cliente={membro} />
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    </details>
                  )}
                </CartaoCorpo>
              </Cartao>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-soft" data-testid="clientes-mostrando">
        Mostrando {lista.grupos.length} de {lista.total}, em ordem alfabética.
      </p>
      {lista.falhaAoCarregarMais && (
        <p role="alert" className="text-sm text-ink" data-testid="clientes-falha-mais">
          {mensagemFalhaBusca(lista.falhaAoCarregarMais)}
        </p>
      )}
      {lista.proximoCursor && (
        <Botao
          type="button"
          variante="secundaria"
          onClick={aoCarregarMais}
          disabled={lista.carregandoMais}
          aria-busy={lista.carregandoMais}
          data-testid="clientes-carregar-mais"
        >
          {lista.carregandoMais ? "Carregando..." : lista.falhaAoCarregarMais ? "Tentar de novo" : "Carregar mais"}
        </Botao>
      )}
    </section>
  );
}
