"use client";

// "Novo agendamento" sob demanda: o formulário EXISTENTE (nova-reserva.tsx,
// com a mesma integração e as mesmas validações) dentro de um painel lateral
// no computador e de baixo para cima no celular.
//
// O painel só é montado aberto: cada abertura começa com o formulário limpo, e
// fechar depois do sucesso descarta o que foi preenchido — o formulário nunca
// fica cheio na tela parecendo um cadastro ainda pendente.
//
// A data do agendamento é a MESMA da agenda ao fundo: mudá-la aqui também move
// a agenda, para a reserva criada aparecer no dia que está na tela.
import Link from "next/link";
import type { AgendamentoReal, SelecaoDeCliente } from "@/lib/api/appointments-api";
import type { EstadoListaProfissionais } from "@/lib/profissionais/use-profissionais-reais";
import { rotuloDaData } from "@/lib/profissionais/agendamentos";
import { Botao } from "@/components/ui/button";
import { PainelLateral } from "@/components/ui/painel-lateral";
import { Skeleton } from "@/components/ui/skeleton";
import { NovaReserva } from "./nova-reserva";

interface PainelNovaReservaProps {
  aberto: boolean;
  aoFechar: () => void;
  tenantId: string;
  date: string;
  aoMudarData: (date: string) => void;
  estadoProfissionais: EstadoListaProfissionais;
  recarregarProfissionais: () => void;
  /** Profissional que o formulário pré-seleciona (o do filtro da agenda). */
  profissionalInicialId: string | null;
  gravando: boolean;
  erro: string | null;
  aoConfirmar: (dados: {
    professionalId: string;
    serviceId: string;
    startAt: string;
    consumer: SelecaoDeCliente;
  }) => Promise<AgendamentoReal | null>;
}

export function PainelNovaReserva({
  aberto,
  aoFechar,
  tenantId,
  date,
  aoMudarData,
  estadoProfissionais,
  recarregarProfissionais,
  profissionalInicialId,
  gravando,
  erro,
  aoConfirmar,
}: PainelNovaReservaProps) {
  return (
    <PainelLateral
      aberto={aberto}
      aoFechar={aoFechar}
      // Fechar com um envio em voo esconderia o resultado dele.
      podeFechar={!gravando}
      titulo="Novo agendamento"
      descricao="Escolha profissional, serviço, cliente e um horário livre."
      data-testid="painel-novo-agendamento"
    >
      <div className="space-y-4">
        <div className="rounded-[var(--radius-card)] border border-border bg-card p-4">
          <label htmlFor="data-reserva" className="mb-1 block text-xs font-medium text-ink-soft">
            Data do agendamento
          </label>
          <input
            id="data-reserva"
            type="date"
            value={date}
            disabled={gravando}
            onChange={(e) => e.target.value && aoMudarData(e.target.value)}
            className="min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink sm:w-56"
          />
          <p className="mt-1 text-xs text-ink-soft first-letter:uppercase">{rotuloDaData(date)}</p>
        </div>

        {estadoProfissionais.status === "carregando" && (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {estadoProfissionais.status === "falha" && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-[color:var(--color-danger)]">
              Não foi possível carregar os profissionais deste estabelecimento.
            </p>
            <Botao type="button" variante="secundaria" onClick={recarregarProfissionais}>
              Tentar novamente
            </Botao>
          </div>
        )}

        {estadoProfissionais.status === "carregada" && (
          <NovaReserva
            tenantId={tenantId}
            date={date}
            profissionais={estadoProfissionais.profissionais}
            profissionalInicialId={profissionalInicialId}
            gravando={gravando}
            erro={erro}
            aoConfirmar={aoConfirmar}
            semProfissional={
              <p className="text-sm text-ink">
                Cadastre um profissional ativo antes de agendar.{" "}
                <Link
                  href="/conta/profissionais"
                  className="font-semibold text-[color:var(--color-accent-hover)] underline"
                >
                  Ir para Profissionais
                </Link>
              </p>
            }
          />
        )}
      </div>
    </PainelLateral>
  );
}
