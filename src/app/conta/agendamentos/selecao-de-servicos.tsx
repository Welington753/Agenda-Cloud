"use client";

// Vários serviços na nova reserva (ver
// docs/plans/agendamento-multiplos-servicos.md): a escolha, entre os serviços
// que o profissional realiza (então ele faz todos), e o resumo com itens,
// preço total e duração total como o servidor calculou na consulta de
// horários. Quem congela os valores é o servidor, no momento da gravação.
import type { DisponibilidadeReal } from "@/lib/api/availability-api";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import { rotuloDeDuracao } from "@/lib/profissionais/agendamentos";
import { alternarServico, MAX_SERVICOS } from "@/lib/profissionais/servicos-da-reserva";
import { formatarPrecoServico } from "@/lib/servicos/dinheiro";

export function SelecaoDeServicos({
  elegiveis,
  escolhidos,
  profissional,
  desabilitado,
  aoMudar,
}: {
  elegiveis: ProfissionalReal["services"];
  escolhidos: readonly string[];
  profissional: string | undefined;
  desabilitado: boolean;
  aoMudar: (atualizar: (atuais: string[]) => string[]) => void;
}) {
  return (
    <fieldset disabled={desabilitado} data-testid="servicos-da-reserva">
      <legend className="mb-1 block text-xs font-medium text-ink-soft">
        Serviços (um ou mais, até {MAX_SERVICOS}, nesta ordem)
      </legend>
      {elegiveis.length === 0 ? (
        <p className="text-sm text-ink">Nenhum serviço vinculado a este profissional.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {elegiveis.map((v) => {
            const marcado = escolhidos.includes(v.serviceId);
            return (
              <li key={v.serviceId}>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={marcado}
                    disabled={!marcado && escolhidos.length >= MAX_SERVICOS}
                    onChange={() => aoMudar((atuais) => alternarServico(atuais, v.serviceId))}
                  />
                  {v.serviceName}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {escolhidos.length > 1 && (
        <p className="mt-2 text-xs text-ink-soft" data-testid="ordem-dos-servicos">
          Atendimento em sequência com {profissional}:{" "}
          {escolhidos.map((id) => elegiveis.find((v) => v.serviceId === id)?.serviceName).join(" + ")}
        </p>
      )}
    </fieldset>
  );
}

/** Itens escolhidos com preço e duração, e os totais, como o servidor
 * calculou na consulta. Preço escondido de quem não vê recebimentos. */
export function ResumoDosItens({ disponibilidade }: { disponibilidade: DisponibilidadeReal }) {
  const itens = disponibilidade.services ?? [];
  if (itens.length === 0) return null;
  const preco = (centavos: number | null) => (disponibilidade.priceHidden ? "" : ` · ${formatarPrecoServico(centavos)}`);
  return (
    <div data-testid="resumo-servicos" className="text-sm text-ink">
      <ul className="space-y-0.5">
        {itens.map((item) => (
          <li key={item.id} className="flex flex-wrap justify-between gap-2">
            <span>{item.name}</span>
            <span className="text-ink-soft">
              {rotuloDeDuracao(item.durationMinutes)}
              {preco(item.priceCents)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 font-semibold" data-testid="total-da-reserva">
        Total: {rotuloDeDuracao(disponibilidade.durationMinutes)}
        {preco(disponibilidade.totalPriceCents ?? null)}
      </p>
    </div>
  );
}
