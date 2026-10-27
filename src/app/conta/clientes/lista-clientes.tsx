"use client";

// Lista de clientes da tela de Clientes: um estado visual para cada
// situação — carregando, falha (com ou sem permissão), nenhum cliente
// cadastrado, nenhum resultado para a busca e a lista em si, com "Carregar
// mais" enquanto o servidor tiver outra página. O total é o do servidor.
import { Mail, MessageCircle, UserPlus, UserRound, Users } from "lucide-react";
import { mensagemFalhaBusca } from "@/lib/clientes/cadastro";
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

function textoDoTotal(total: number, termo: string | null): string {
  const quantidade = total === 1 ? "1 cliente" : `${total} clientes`;
  if (termo) return `${quantidade} ${total === 1 ? "encontrado" : "encontrados"} para “${termo}”`;
  return `${quantidade} ${total === 1 ? "cadastrado" : "cadastrados"}`;
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

  if (lista.clientes.length === 0) {
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
        {textoDoTotal(lista.total, lista.termo)}
      </h2>
      <ul className="space-y-2" data-testid="lista-clientes">
        {lista.clientes.map((cliente) => (
          <li key={cliente.id}>
            <Cartao className={cliente.id === destacadoId ? "ring-1 ring-accent" : undefined}>
              <CartaoCorpo className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="min-w-0 font-semibold break-words text-ink">{cliente.name}</p>
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
                </div>
                <LinkWhatsappCliente
                  nome={cliente.name}
                  telefone={cliente.whatsapp}
                  className="self-start sm:self-auto"
                />
              </CartaoCorpo>
            </Cartao>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-soft" data-testid="clientes-mostrando">
        Mostrando {lista.clientes.length} de {lista.total}, em ordem alfabética.
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
