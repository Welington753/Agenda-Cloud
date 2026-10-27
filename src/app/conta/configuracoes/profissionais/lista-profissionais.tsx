"use client";

// Lista de profissionais reais em cartões — espelha servicos/lista-servicos.tsx
// e o estilo da demonstração: avatar, nome e estado no topo, serviços
// vinculados no meio, acesso a Horários e Disponibilidade e as ações no
// rodapé. O profissional inativo continua visível e marcado (nunca esconde o
// registro); cada serviço vinculado mostra seu próprio estado, porque um
// vínculo pode continuar existindo com o serviço já desativado.
//
// Só o que o contrato real traz: nada de "aceita agendamento online" ou outra
// informação sem campo de verdade no backend.
import Link from "next/link";
import clsx from "clsx";
import { Ban, CalendarClock, CalendarSearch, Pencil, RotateCcw } from "lucide-react";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";

const CLASSE_LINK_SECUNDARIO =
  "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-border px-3 text-sm font-semibold text-ink hover:bg-paper-muted";

interface ListaProfissionaisProps {
  profissionais: ProfissionalReal[];
  gravando: boolean;
  confirmando: ProfissionalReal | null;
  reativandoId: string | null;
  aoEditar: (profissional: ProfissionalReal) => void;
  aoPedirDesativacao: (profissional: ProfissionalReal) => void;
  aoCancelarDesativacao: () => void;
  aoConfirmarDesativacao: (profissional: ProfissionalReal) => void;
  aoReativar: (profissional: ProfissionalReal) => void;
}

export function ListaProfissionais({
  profissionais,
  gravando,
  confirmando,
  reativandoId,
  aoEditar,
  aoPedirDesativacao,
  aoCancelarDesativacao,
  aoConfirmarDesativacao,
  aoReativar,
}: ListaProfissionaisProps) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="lista-profissionais">
      {profissionais.map((profissional) => {
        const confirmandoEste = confirmando?.id === profissional.id;
        const reativandoEste = reativandoId === profissional.id;
        return (
          <li key={profissional.id} className="min-w-0">
            <article
              aria-label={profissional.name}
              className={clsx(
                "flex h-full flex-col rounded-[var(--radius-card)] border border-border shadow-[var(--shadow-soft)]",
                profissional.active ? "bg-card" : "bg-paper-muted/60",
              )}
            >
              <div className="flex-1 space-y-3 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <span
                    className={clsx(
                      "flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
                      !profissional.active && "opacity-60",
                    )}
                    style={{ backgroundColor: profissional.avatarColor }}
                    aria-hidden="true"
                  >
                    {profissional.avatarInitials}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <h2
                      className={clsx(
                        "text-base font-semibold break-words",
                        profissional.active ? "text-ink" : "text-ink-soft",
                      )}
                    >
                      {profissional.name}
                    </h2>
                    <Badge cor={profissional.active ? "sucesso" : "neutro"}>
                      {profissional.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium text-ink-soft">Serviços vinculados</p>
                  {profissional.services.length === 0 ? (
                    <p className="text-sm text-ink-soft">Nenhum serviço vinculado.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {profissional.services.map((vinculo) => (
                        <li key={vinculo.id}>
                          <Badge cor={vinculo.serviceActive ? "destaque" : "neutro"}>
                            {vinculo.serviceActive
                              ? vinculo.serviceName
                              : `${vinculo.serviceName} (inativo)`}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="space-y-2 border-t border-border px-4 py-3 sm:px-5">
                {/* Horários semanais (Lote 6D.3) e consulta de disponibilidade
                    (Lote 6D.4) — telas próprias. Disponibilidade só para quem
                    atende: o profissional desativado não tem agenda a oferecer. */}
                <div className="flex gap-2">
                  <Link
                    href={`/conta/configuracoes/profissionais/${profissional.id}/horarios`}
                    aria-label={`Horários de ${profissional.name}`}
                    className={CLASSE_LINK_SECUNDARIO}
                  >
                    <CalendarClock size={14} aria-hidden="true" />
                    Horários
                  </Link>
                  {profissional.active && (
                    <Link
                      href={`/conta/configuracoes/profissionais/${profissional.id}/disponibilidade`}
                      aria-label={`Disponibilidade de ${profissional.name}`}
                      className={CLASSE_LINK_SECUNDARIO}
                    >
                      <CalendarSearch size={14} aria-hidden="true" />
                      Disponibilidade
                    </Link>
                  )}
                </div>

                {confirmandoEste ? (
                  <div className="space-y-2 rounded-[var(--radius-control)] border border-dashed border-border p-3">
                    <p className="text-sm text-ink">
                      Desativar <strong>{profissional.name}</strong>? Ele deixa de aparecer para
                      novos agendamentos, mas continua salvo e os serviços vinculados são
                      preservados. Reservas já marcadas com ele continuam na agenda para você
                      tratar, e um acesso de funcionário ligado a ele deixa de funcionar até a
                      reativação.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Botao
                        type="button"
                        variante="perigo"
                        tamanho="sm"
                        disabled={gravando}
                        aria-busy={gravando}
                        onClick={() => aoConfirmarDesativacao(profissional)}
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
                      variante="fantasma"
                      tamanho="sm"
                      className="min-h-11 flex-1"
                      disabled={gravando}
                      onClick={() => aoEditar(profissional)}
                      aria-label={`Editar ${profissional.name}`}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      Editar
                    </Botao>
                    {profissional.active ? (
                      <Botao
                        type="button"
                        variante="fantasma"
                        tamanho="sm"
                        className="min-h-11 flex-1"
                        disabled={gravando}
                        onClick={() => aoPedirDesativacao(profissional)}
                        aria-label={`Desativar ${profissional.name}`}
                      >
                        <Ban size={14} aria-hidden="true" />
                        Desativar
                      </Botao>
                    ) : (
                      <Botao
                        type="button"
                        variante="fantasma"
                        tamanho="sm"
                        className="min-h-11 flex-1"
                        disabled={gravando}
                        aria-busy={reativandoEste}
                        onClick={() => aoReativar(profissional)}
                        aria-label={`Reativar ${profissional.name}`}
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
