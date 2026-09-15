"use client";

// Lista de serviços reais, com a confirmação de desativação embutida na
// própria linha (nunca um `window.confirm`, que não é acessível nem
// estilizável). Extraída da página para manter os arquivos dentro do
// orçamento do lint.
//
// O serviço inativo continua visível e claramente marcado — desativar nunca
// esconde o registro, porque ele segue existindo no banco. Reativação é ação
// direta (sem confirmação): reverter uma desativação não é destrutivo, então
// não exige o mesmo passo extra.
import { Ban, Pencil, RotateCcw } from "lucide-react";
import type { ServicoReal } from "@/lib/api/services-api";
import { formatarPrecoServico } from "@/lib/servicos/dinheiro";
import { formatarDuracao } from "@/lib/format";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

const ROTULO_MODALIDADE: Record<ServicoReal["modality"], string> = {
  IN_PERSON: "Presencial",
  REMOTE: "Remoto",
  HOME: "No endereço do cliente",
};

interface ListaServicosProps {
  servicos: ServicoReal[];
  gravando: boolean;
  confirmando: ServicoReal | null;
  /** Id do serviço sendo reativado agora, para trocar só o rótulo daquele
   * botão — `gravando` sozinho não diria QUAL serviço está em voo. */
  reativandoId: string | null;
  aoEditar: (servico: ServicoReal) => void;
  aoPedirDesativacao: (servico: ServicoReal) => void;
  aoCancelarDesativacao: () => void;
  aoConfirmarDesativacao: (servico: ServicoReal) => void;
  aoReativar: (servico: ServicoReal) => void;
}

export function ListaServicos({
  servicos,
  gravando,
  confirmando,
  reativandoId,
  aoEditar,
  aoPedirDesativacao,
  aoCancelarDesativacao,
  aoConfirmarDesativacao,
  aoReativar,
}: ListaServicosProps) {
  return (
    <ul className="space-y-3">
      {servicos.map((servico) => {
        const confirmandoEste = confirmando?.id === servico.id;
        const reativandoEste = reativandoId === servico.id;
        return (
          <li key={servico.id}>
            <Cartao className={servico.active ? undefined : "opacity-70"}>
              <CartaoCorpo className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">{servico.name}</p>
                      {!servico.active && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                          Inativo
                        </span>
                      )}
                    </div>
                    {servico.shortDescription && (
                      <p className="mt-0.5 text-sm text-ink-soft">{servico.shortDescription}</p>
                    )}
                    <p className="mt-1 text-xs text-ink-soft">
                      {formatarDuracao(servico.durationMinutes)} ·{" "}
                      {formatarPrecoServico(servico.priceCents)} ·{" "}
                      {ROTULO_MODALIDADE[servico.modality]}
                    </p>
                  </div>

                  {!confirmandoEste && (
                    <div className="flex shrink-0 gap-1.5">
                      <Botao
                        type="button"
                        variante="secundaria"
                        tamanho="sm"
                        disabled={gravando}
                        onClick={() => aoEditar(servico)}
                        aria-label={`Editar ${servico.name}`}
                      >
                        <Pencil size={14} className="mr-1" />
                        Editar
                      </Botao>
                      {servico.active ? (
                        <Botao
                          type="button"
                          variante="secundaria"
                          tamanho="sm"
                          disabled={gravando}
                          onClick={() => aoPedirDesativacao(servico)}
                          aria-label={`Desativar ${servico.name}`}
                        >
                          <Ban size={14} className="mr-1" />
                          Desativar
                        </Botao>
                      ) : (
                        <Botao
                          type="button"
                          variante="secundaria"
                          tamanho="sm"
                          disabled={gravando}
                          aria-busy={reativandoEste}
                          onClick={() => aoReativar(servico)}
                          aria-label={`Reativar ${servico.name}`}
                        >
                          <RotateCcw size={14} className="mr-1" />
                          {reativandoEste ? "Reativando..." : "Reativar"}
                        </Botao>
                      )}
                    </div>
                  )}
                </div>

                {confirmandoEste && (
                  <div className="space-y-2 rounded-[var(--radius-control)] border border-dashed border-border p-3">
                    <p className="text-sm text-ink">
                      Desativar <strong>{servico.name}</strong>? Ele deixa de ser oferecido em novos
                      agendamentos, mas continua salvo e o histórico é preservado.
                    </p>
                    <div className="flex gap-2">
                      <Botao
                        type="button"
                        variante="perigo"
                        tamanho="sm"
                        disabled={gravando}
                        aria-busy={gravando}
                        onClick={() => aoConfirmarDesativacao(servico)}
                      >
                        {gravando ? "Desativando..." : "Confirmar desativação"}
                      </Botao>
                      <Botao
                        type="button"
                        variante="secundaria"
                        tamanho="sm"
                        disabled={gravando}
                        onClick={aoCancelarDesativacao}
                      >
                        Manter ativo
                      </Botao>
                    </div>
                  </div>
                )}
              </CartaoCorpo>
            </Cartao>
          </li>
        );
      })}
    </ul>
  );
}
