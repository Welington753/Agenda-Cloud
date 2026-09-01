import clsx from "clsx";
import type { StatusAgendamento, StatusConvite, StatusEstabelecimento, StatusUsuario } from "@/lib/types";

type CorBadge = "neutro" | "sucesso" | "erro" | "aviso" | "info" | "destaque";

const CLASSE_COR: Record<CorBadge, string> = {
  neutro: "bg-paper-muted text-ink-soft",
  sucesso: "bg-success-soft text-[color:var(--color-success)]",
  erro: "bg-danger-soft text-[color:var(--color-danger)]",
  aviso: "bg-warning-soft text-[color:var(--color-warning)]",
  info: "bg-info-soft text-[color:var(--color-info)]",
  destaque: "bg-accent-soft text-[color:var(--color-accent-hover)]",
};

export function Badge({ cor = "neutro", children }: { cor?: CorBadge; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        CLASSE_COR[cor]
      )}
    >
      {children}
    </span>
  );
}

const CONFIG_STATUS_AGENDAMENTO: Record<StatusAgendamento, { rotulo: string; cor: CorBadge }> = {
  pendente: { rotulo: "Pendente", cor: "aviso" },
  confirmado: { rotulo: "Confirmado", cor: "info" },
  em_atendimento: { rotulo: "Em atendimento", cor: "destaque" },
  concluido: { rotulo: "Concluído", cor: "sucesso" },
  cancelado: { rotulo: "Cancelado", cor: "neutro" },
  nao_compareceu: { rotulo: "Não compareceu", cor: "erro" },
};

export function BadgeStatusAgendamento({ status }: { status: StatusAgendamento }) {
  const { rotulo, cor } = CONFIG_STATUS_AGENDAMENTO[status];
  return <Badge cor={cor}>{rotulo}</Badge>;
}

const CONFIG_STATUS_ESTABELECIMENTO: Record<StatusEstabelecimento, { rotulo: string; cor: CorBadge }> = {
  teste: { rotulo: "Em teste", cor: "info" },
  ativo: { rotulo: "Ativo", cor: "sucesso" },
  suspenso: { rotulo: "Suspenso", cor: "erro" },
  inadimplente: { rotulo: "Inadimplente", cor: "aviso" },
  cancelado: { rotulo: "Cancelado", cor: "erro" },
};

export function BadgeStatusEstabelecimento({ status }: { status: StatusEstabelecimento }) {
  const { rotulo, cor } = CONFIG_STATUS_ESTABELECIMENTO[status];
  return <Badge cor={cor}>{rotulo}</Badge>;
}

const CONFIG_STATUS_USUARIO: Record<StatusUsuario, { rotulo: string; cor: CorBadge }> = {
  ativo: { rotulo: "Ativo", cor: "sucesso" },
  suspenso: { rotulo: "Suspenso", cor: "erro" },
  convidado: { rotulo: "Convidado", cor: "aviso" },
};

export function BadgeStatusUsuario({ status }: { status: StatusUsuario }) {
  const { rotulo, cor } = CONFIG_STATUS_USUARIO[status];
  return <Badge cor={cor}>{rotulo}</Badge>;
}

const CONFIG_STATUS_CONVITE: Record<StatusConvite, { rotulo: string; cor: CorBadge }> = {
  pendente: { rotulo: "Pendente", cor: "aviso" },
  aceito: { rotulo: "Aceito", cor: "sucesso" },
  expirado: { rotulo: "Expirado", cor: "neutro" },
  revogado: { rotulo: "Revogado", cor: "erro" },
};

export function BadgeStatusConvite({ status }: { status: StatusConvite }) {
  const { rotulo, cor } = CONFIG_STATUS_CONVITE[status];
  return <Badge cor={cor}>{rotulo}</Badge>;
}
