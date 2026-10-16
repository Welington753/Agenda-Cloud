import { Badge, type CorBadge } from "./badge-base";
import type { StatusAgendamento, StatusConvite, StatusEstabelecimento, StatusUsuario } from "@/lib/types";

export { Badge };

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
