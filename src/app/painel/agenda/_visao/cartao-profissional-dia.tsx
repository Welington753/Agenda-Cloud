import { CalendarDays, CalendarX2, Plus } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { BadgeStatusAgendamento } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/empty-state";
import { formatarHora } from "@/lib/format";
import type { Agendamento, Bloqueio, Permission, Profissional, Servico } from "@/lib/types";
import type { Terminologia } from "@/lib/verticals/terminologia";

interface CartaoProfissionalDiaProps {
  profissional: Profissional;
  itensAgendamento: Agendamento[];
  itensBloqueio: Bloqueio[];
  servicoPorId: Map<string, Servico>;
  podeAcessar: (permissao: Permission) => { permitido: boolean };
  terminologia: Terminologia;
  aoSelecionarAgendamento: (agendamento: Agendamento) => void;
  aoNovoAgendamento: (profissionalId: string) => void;
  aoNovoBloqueio: (profissionalId: string) => void;
  aoRemoverBloqueio: (bloqueioId: string) => void;
}

export function CartaoProfissionalDia({
  profissional,
  itensAgendamento,
  itensBloqueio,
  servicoPorId,
  podeAcessar,
  terminologia,
  aoSelecionarAgendamento,
  aoNovoAgendamento,
  aoNovoBloqueio,
  aoRemoverBloqueio,
}: CartaoProfissionalDiaProps) {
  const semItens = itensAgendamento.length === 0 && itensBloqueio.length === 0;

  return (
    <Cartao>
      <CartaoCorpo className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: profissional.corAvatar }}
            >
              {profissional.avatarIniciais}
            </div>
            <p className="font-semibold text-ink">{profissional.nome}</p>
          </div>
          <div className="flex gap-1">
            {podeAcessar("agendamento.criar").permitido && (
              <button
                type="button"
                aria-label={`${terminologia.agendamento.artigo === "a" ? "Nova" : "Novo"} ${terminologia.agendamento.singular.toLowerCase()} para ${profissional.nome}`}
                onClick={() => aoNovoAgendamento(profissional.id)}
                className="flex size-8 items-center justify-center rounded-full border border-border hover:bg-paper-muted"
              >
                <Plus size={16} />
              </button>
            )}
            {podeAcessar("agenda.gerenciar").permitido && (
              <button
                type="button"
                aria-label={`Bloquear horário de ${profissional.nome}`}
                onClick={() => aoNovoBloqueio(profissional.id)}
                className="flex size-8 items-center justify-center rounded-full border border-border hover:bg-paper-muted"
              >
                <CalendarX2 size={16} />
              </button>
            )}
          </div>
        </div>

        {semItens ? (
          <EstadoVazio icone={CalendarDays} titulo="Nenhum item neste dia" />
        ) : (
          <ul className="space-y-2">
            {itensBloqueio.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-paper-muted px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-soft">{b.motivo}</p>
                  <p className="text-xs text-ink-soft">
                    {formatarHora(b.inicio)} – {formatarHora(b.fim)}
                  </p>
                </div>
                {podeAcessar("agenda.gerenciar").permitido && (
                  <button
                    type="button"
                    onClick={() => aoRemoverBloqueio(b.id)}
                    className="shrink-0 text-xs font-semibold text-[color:var(--color-danger)] hover:underline"
                  >
                    Remover
                  </button>
                )}
              </li>
            ))}
            {itensAgendamento.map((a) => {
              const servico = servicoPorId.get(a.servicoId);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => aoSelecionarAgendamento(a)}
                    className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2 text-left text-sm hover:border-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{a.consumidorNome}</p>
                      <p className="truncate text-xs text-ink-soft">{servico?.nome}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-ink">{formatarHora(a.dataHoraInicio)}</p>
                      <BadgeStatusAgendamento status={a.status} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
