"use client";

// Lista de serviços reais em cartões (grade no computador, uma coluna no
// celular), no estilo dos cartões da demonstração: nome e descrição no topo,
// preço e duração em destaque, estado explícito e as ações no rodapé. A
// confirmação de desativação continua embutida no próprio cartão (nunca um
// `window.confirm`, que não é acessível nem estilizável).
//
// O serviço inativo continua visível e claramente marcado — desativar nunca
// esconde o registro, porque ele segue existindo no banco. Reativação é ação
// direta (sem confirmação): reverter uma desativação não é destrutivo, então
// não exige o mesmo passo extra.
import clsx from "clsx";
import Link from "next/link";
import { Ban, Clock, Globe, MapPin, Pencil, RotateCcw } from "lucide-react";
import type { ServicoReal } from "@/lib/api/services-api";
import { formatarPrecoServico } from "@/lib/servicos/dinheiro";
import type { MotivoForaDoOnline } from "@/lib/servicos/agendamento-online";
import { formatarDuracao } from "@/lib/format";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";

const ROTULO_MODALIDADE: Record<ServicoReal["modality"], string> = {
  IN_PERSON: "Presencial",
  REMOTE: "Remoto",
  HOME: "No endereço do cliente",
};

interface ListaServicosProps {
  servicos: ServicoReal[];
  /** Serviços ativos que o cliente ainda não vê no agendamento online. */
  motivosForaDoOnline: ReadonlyMap<string, MotivoForaDoOnline>;
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
  motivosForaDoOnline,
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
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="lista-servicos">
      {servicos.map((servico) => {
        const confirmandoEste = confirmando?.id === servico.id;
        const reativandoEste = reativandoId === servico.id;
        return (
          <li key={servico.id} className="min-w-0">
            <article
              aria-label={servico.name}
              className={clsx(
                "flex h-full flex-col rounded-[var(--radius-card)] border border-border shadow-[var(--shadow-soft)]",
                servico.active ? "bg-card" : "bg-paper-muted/60",
              )}
            >
              <div className="flex-1 space-y-3 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2
                    className={clsx(
                      "min-w-0 text-base font-semibold break-words",
                      servico.active ? "text-ink" : "text-ink-soft",
                    )}
                  >
                    {servico.name}
                  </h2>
                  <Badge cor={servico.active ? "sucesso" : "neutro"}>
                    {servico.active ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                {servico.shortDescription && (
                  <p className="text-sm text-ink-soft">{servico.shortDescription}</p>
                )}
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  {/* Preço nulo é "Sob consulta", nunca R$ 0,00 (ver
                      lib/servicos/dinheiro.ts). */}
                  <p className="text-lg font-bold text-[color:var(--color-accent-hover)]">
                    {formatarPrecoServico(servico.priceCents)}
                  </p>
                  <p className="inline-flex items-center gap-1 text-sm text-ink">
                    <Clock size={14} aria-hidden="true" className="text-ink-soft" />
                    {formatarDuracao(servico.durationMinutes)}
                  </p>
                </div>
                <p className="inline-flex items-center gap-1 text-xs text-ink-soft">
                  <MapPin size={12} aria-hidden="true" />
                  {ROTULO_MODALIDADE[servico.modality]}
                </p>
                <AvisoForaDoOnline motivo={motivosForaDoOnline.get(servico.id)} />
              </div>

              <div className="border-t border-border px-4 py-3 sm:px-5">
                {confirmandoEste ? (
                  <div className="space-y-2">
                    <p className="text-sm text-ink">
                      Desativar <strong>{servico.name}</strong>? Ele deixa de ser oferecido em novos
                      agendamentos, mas continua salvo e o histórico é preservado.
                    </p>
                    <div className="flex flex-wrap gap-2">
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
                ) : (
                  <div className="flex gap-2">
                    <Botao
                      type="button"
                      variante="secundaria"
                      tamanho="sm"
                      className="min-h-11 flex-1"
                      disabled={gravando}
                      onClick={() => aoEditar(servico)}
                      aria-label={`Editar ${servico.name}`}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      Editar
                    </Botao>
                    {servico.active ? (
                      <Botao
                        type="button"
                        variante="secundaria"
                        tamanho="sm"
                        className="min-h-11 flex-1"
                        disabled={gravando}
                        onClick={() => aoPedirDesativacao(servico)}
                        aria-label={`Desativar ${servico.name}`}
                      >
                        <Ban size={14} aria-hidden="true" />
                        Desativar
                      </Botao>
                    ) : (
                      <Botao
                        type="button"
                        variante="secundaria"
                        tamanho="sm"
                        className="min-h-11 flex-1"
                        disabled={gravando}
                        aria-busy={reativandoEste}
                        onClick={() => aoReativar(servico)}
                        aria-label={`Reativar ${servico.name}`}
                      >
                        <RotateCcw size={14} aria-hidden="true" />
                        {reativandoEste ? "Reativando..." : "Reativar"}
                      </Botao>
                    )}
                  </div>
                )}
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

/** O que falta para o serviço aparecer no agendamento online. Só explica e
 * aponta o caminho: nada é ligado nem vinculado daqui. */
function AvisoForaDoOnline({ motivo }: { motivo: MotivoForaDoOnline | undefined }) {
  if (!motivo) return null;
  return (
    <p
      data-testid="servico-fora-do-online"
      className="flex items-start gap-2 rounded-[var(--radius-control)] border border-warning bg-warning-soft p-2.5 text-xs text-ink"
    >
      <Globe size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
      {motivo === "sem_profissional" ? (
        <span>
          <strong>Não aparece no agendamento online:</strong> nenhum profissional ativo realiza este serviço.
          Marque-o em um profissional, em{" "}
          <Link href="/conta/profissionais" className="font-semibold underline">
            Profissionais
          </Link>
          .
        </span>
      ) : (
        <span>
          <strong>Não aparece no agendamento online:</strong> este serviço está desligado no agendamento online.
        </span>
      )}
    </p>
  );
}
