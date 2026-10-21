"use client";

// Área de resultados da busca de clientes: um estado visual para cada
// situação — antes da busca, buscando, falha (com ou sem permissão), nenhum
// resultado e resultados. Nunca apresenta a lista como "todos os clientes":
// a rota só pesquisa, e devolve no máximo `LIMITE_BUSCA_CLIENTES` linhas.
import { Mail, MessageCircle, Search, UserPlus, UserRound } from "lucide-react";
import { LIMITE_BUSCA_CLIENTES, TERMO_MINIMO_BUSCA } from "@/lib/api/consumers-api";
import { mensagemFalhaBusca } from "@/lib/clientes/cadastro";
import type { EstadoBuscaClientes } from "@/lib/clientes/use-clientes-reais";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface ResultadoBuscaProps {
  busca: EstadoBuscaClientes;
  /** Id do cliente recém-cadastrado, para destacá-lo na lista. */
  destacadoId: string | null;
  aoRepetir: () => void;
  aoCadastrar: (() => void) | null;
}

export function ResultadoBusca({ busca, destacadoId, aoRepetir, aoCadastrar }: ResultadoBuscaProps) {
  if (busca.status === "inicial") {
    return (
      <EstadoVazio
        icone={Search}
        titulo="Pesquise para encontrar um cliente"
        descricao={`Digite pelo menos ${TERMO_MINIMO_BUSCA} letras do nome ou 4 dígitos do WhatsApp. A lista completa não é exibida: cada busca mostra até ${LIMITE_BUSCA_CLIENTES} clientes.`}
      />
    );
  }

  if (busca.status === "buscando") {
    return (
      <div className="space-y-3" aria-busy="true" data-testid="clientes-buscando">
        <p role="status" className="text-sm text-ink-soft">
          Buscando “{busca.termo}”...
        </p>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (busca.status === "falha") {
    const semPermissao = busca.falha.tipo === "sem_permissao" || busca.falha.tipo === "sem_acesso";
    return (
      <Cartao>
        <CartaoCorpo className="space-y-3" data-testid={semPermissao ? "clientes-sem-permissao" : "clientes-falha"}>
          <p role="alert" className="text-sm text-ink">
            {mensagemFalhaBusca(busca.falha)}
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

  if (busca.clientes.length === 0) {
    return (
      <div data-testid="clientes-nenhum">
        <EstadoVazio
          icone={UserRound}
          titulo={`Nenhum cliente encontrado para “${busca.termo}”`}
          descricao="Confira a grafia ou tente parte do nome ou do WhatsApp."
          acao={
            aoCadastrar ? (
              <Botao type="button" onClick={aoCadastrar}>
                <UserPlus size={16} aria-hidden="true" />
                Cadastrar cliente
              </Botao>
            ) : undefined
          }
        />
      </div>
    );
  }

  const quantidade = busca.clientes.length;
  return (
    <section aria-labelledby="titulo-resultados" className="space-y-3">
      <h2 id="titulo-resultados" className="text-sm font-semibold text-ink" role="status">
        {quantidade === 1 ? "1 cliente encontrado" : `${quantidade} clientes encontrados`} para “
        {busca.termo}”
      </h2>
      {busca.talvezIncompleta && (
        <p className="text-xs text-ink-soft" data-testid="clientes-limite">
          Mostrando os primeiros {LIMITE_BUSCA_CLIENTES} resultados. Pode haver outros clientes com
          esse termo — refine a busca para encontrá-los.
        </p>
      )}
      <ul className="space-y-2" data-testid="lista-clientes">
        {busca.clientes.map((cliente) => (
          <li key={cliente.id}>
            <Cartao className={cliente.id === destacadoId ? "ring-1 ring-accent" : undefined}>
              <CartaoCorpo className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 break-words font-semibold text-ink">{cliente.name}</p>
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
              </CartaoCorpo>
            </Cartao>
          </li>
        ))}
      </ul>
    </section>
  );
}
