"use client";

// Cliente da venda: balcão (sem cliente) ou um cadastro escolhido por TOQUE
// num resultado da busca limitada (nome e final do telefone; nunca e-mail
// nem telefone inteiro). O texto digitado nunca escolhe ninguém, nem quando
// há um resultado só; nomes iguais aparecem lado a lado, sem pré-seleção.
// O pedido leva só o ID escolhido.
import { useEffect, useState } from "react";
import { Search, UserRound, X } from "lucide-react";
import clsx from "clsx";
import { Botao } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CLASSE_CAMPO } from "@/components/estoque/comum";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { caminhoBuscaDeClientes, ehBuscaDeClientes, type ClienteDaBusca } from "@/lib/api/vendas-api";
import { buscaDeClientePronta, clienteTocado, idsComNomeRepetido, rotuloDoCliente } from "@/lib/vendas/apresentacao";

export function EscolhaDeCliente({
  tenantId,
  cliente,
  aoEscolher,
  desativado,
}: {
  tenantId: string;
  cliente: ClienteDaBusca | null;
  aoEscolher: (cliente: ClienteDaBusca | null) => void;
  desativado: boolean;
}) {
  const [modo, setModo] = useState<"balcao" | "cliente">(cliente ? "cliente" : "balcao");
  const [busca, setBusca] = useState("");
  const [consulta, setConsulta] = useState("");

  useEffect(() => {
    const espera = setTimeout(() => setConsulta(busca.trim()), 350);
    return () => clearTimeout(espera);
  }, [busca]);

  const pronta = modo === "cliente" && !cliente && buscaDeClientePronta(consulta);
  const { estado } = useLeituraPlataforma(pronta ? caminhoBuscaDeClientes(tenantId, consulta) : null, ehBuscaDeClientes);
  const resultados = estado.status === "pronto" ? estado.dados.consumers : [];
  const repetidos = idsComNomeRepetido(resultados);

  function trocarModo(novo: "balcao" | "cliente") {
    setModo(novo);
    if (novo === "balcao") aoEscolher(null);
  }

  return (
    <fieldset disabled={desativado} className="space-y-3" data-testid="escolha-de-cliente">
      <legend className="text-sm font-semibold text-ink">Cliente</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ["balcao", "Venda de balcão", "Sem cliente identificado."],
            ["cliente", "Cliente cadastrado", "Procure pelo nome ou pelos 4 últimos dígitos do telefone."],
          ] as const
        ).map(([valor, rotulo, descricao]) => (
          <label
            key={valor}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-[color:var(--color-accent)]"
          >
            <input type="radio" name="modo-cliente" className="mt-0.5 size-5 shrink-0" checked={modo === valor} onChange={() => trocarModo(valor)} data-testid={`modo-${valor}`} />
            <span className="min-w-0">
              <span className="font-medium text-ink">{rotulo}</span>
              <span className="block text-xs text-ink-soft">{descricao}</span>
            </span>
          </label>
        ))}
      </div>

      {modo === "cliente" && cliente && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--color-accent)] bg-accent-soft p-3 text-sm" data-testid="cliente-escolhido">
          <span className="inline-flex min-w-0 items-center gap-2 text-ink">
            <UserRound size={16} aria-hidden="true" className="shrink-0" />
            <span className="break-words">{rotuloDoCliente(cliente)}</span>
          </span>
          <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => aoEscolher(null)}>
            <X size={16} aria-hidden="true" />
            Trocar cliente
          </Botao>
        </div>
      )}

      {modo === "cliente" && !cliente && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-ink" htmlFor="busca-cliente-venda">
            Procurar cliente
          </label>
          <div className="relative">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
            <input
              id="busca-cliente-venda"
              className={`min-h-11 pl-9 ${CLASSE_CAMPO}`}
              value={busca}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome ou final do telefone"
            />
          </div>
          {!buscaDeClientePronta(busca) && <p className="text-xs text-ink-soft">Digite pelo menos 2 caracteres.</p>}
          {pronta && estado.status === "carregando" && <Skeleton className="h-11 w-full" />}
          {pronta && estado.status === "erro" && (
            <p role="alert" className="text-sm text-ink">
              Não foi possível procurar clientes agora.
            </p>
          )}
          {pronta && estado.status === "pronto" && resultados.length === 0 && (
            <p className="text-sm text-ink-soft" data-testid="sem-clientes">
              Nenhum cliente ativo encontrado. A venda pode seguir como balcão; cadastrar cliente novo é em Clientes.
            </p>
          )}
          {resultados.length > 0 && (
            <>
              {repetidos.size > 0 && (
                <p className="text-xs text-ink-soft" data-testid="aviso-nomes-iguais">
                  Há cadastros com o mesmo nome. Confira o final do telefone antes de escolher.
                </p>
              )}
              <ul className="space-y-1" data-testid="resultados-cliente">
                {resultados.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={clsx(
                        "flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm text-ink hover:bg-paper-muted",
                        repetidos.has(r.id) ? "border-[color:var(--color-warning)]" : "border-border",
                      )}
                      onClick={() => {
                        const tocado = clienteTocado(resultados, r.id);
                        if (tocado) aoEscolher(tocado);
                      }}
                      data-testid="resultado-cliente"
                    >
                      <UserRound size={16} aria-hidden="true" className="shrink-0 text-ink-soft" />
                      <span className="min-w-0 break-words">{rotuloDoCliente(r)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
