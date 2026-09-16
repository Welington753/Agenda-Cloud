"use client";

// Lista de profissionais reais — espelha servicos/lista-servicos.tsx. O
// profissional inativo continua visível e marcado (nunca esconde o
// registro); cada serviço vinculado mostra seu próprio estado, porque um
// vínculo pode continuar existindo com o serviço já desativado.
import Link from "next/link";
import { Ban, CalendarClock, CalendarSearch, Pencil, RotateCcw } from "lucide-react";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

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
    <ul className="space-y-3">
      {profissionais.map((profissional) => {
        const confirmandoEste = confirmando?.id === profissional.id;
        const reativandoEste = reativandoId === profissional.id;
        return (
          <li key={profissional.id}>
            <Cartao className={profissional.active ? undefined : "opacity-70"}>
              <CartaoCorpo className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: profissional.avatarColor }}
                      aria-hidden="true"
                    >
                      {profissional.avatarInitials}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{profissional.name}</p>
                        {!profissional.active && (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                            Inativo
                          </span>
                        )}
                      </div>
                      {profissional.services.length === 0 ? (
                        <p className="mt-1 text-xs text-ink-soft">Nenhum serviço vinculado.</p>
                      ) : (
                        <ul className="mt-1 flex flex-wrap gap-1.5">
                          {profissional.services.map((vinculo) => (
                            <li
                              key={vinculo.id}
                              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-soft"
                            >
                              {vinculo.serviceName}
                              {!vinculo.serviceActive && " (inativo)"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {!confirmandoEste && (
                    <div className="flex shrink-0 gap-1.5">
                      <Botao
                        type="button"
                        variante="secundaria"
                        tamanho="sm"
                        disabled={gravando}
                        onClick={() => aoEditar(profissional)}
                        aria-label={`Editar ${profissional.name}`}
                      >
                        <Pencil size={14} className="mr-1" />
                        Editar
                      </Botao>
                      {/* Horários semanais (Lote 6D.3) — tela própria, porque
                          é outro recurso do backend (professional_schedules). */}
                      <Link
                        href={`/conta/profissionais/${profissional.id}/horarios`}
                        aria-label={`Horários de ${profissional.name}`}
                        className="inline-flex items-center rounded-[var(--radius-control)] border border-border px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent"
                      >
                        <CalendarClock size={14} className="mr-1" />
                        Horários
                      </Link>
                      {/* Consulta de disponibilidade (Lote 6D.4) — só faz
                          sentido para quem atende: o profissional desativado
                          não tem agenda a oferecer. */}
                      {profissional.active && (
                        <Link
                          href={`/conta/profissionais/${profissional.id}/disponibilidade`}
                          aria-label={`Disponibilidade de ${profissional.name}`}
                          className="inline-flex items-center rounded-[var(--radius-control)] border border-border px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent"
                        >
                          <CalendarSearch size={14} className="mr-1" />
                          Disponibilidade
                        </Link>
                      )}
                      {profissional.active ? (
                        <Botao
                          type="button"
                          variante="secundaria"
                          tamanho="sm"
                          disabled={gravando}
                          onClick={() => aoPedirDesativacao(profissional)}
                          aria-label={`Desativar ${profissional.name}`}
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
                          onClick={() => aoReativar(profissional)}
                          aria-label={`Reativar ${profissional.name}`}
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
                      Desativar <strong>{profissional.name}</strong>? Ele deixa de aparecer para novos
                      agendamentos, mas continua salvo e os serviços vinculados são preservados.
                    </p>
                    <div className="flex gap-2">
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
                )}
              </CartaoCorpo>
            </Cartao>
          </li>
        );
      })}
    </ul>
  );
}
