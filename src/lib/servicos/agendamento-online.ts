// Por que um serviço ATIVO não aparece no agendamento online — regra pura,
// testada em agendamento-online.test.ts, para a tela de Serviços avisar o
// dono. Espelha a elegibilidade do servidor (public-booking.service.ts,
// `profile`): serviço ativo, ligado no online e realizado por pelo menos um
// profissional ativo e ligado no online.
//
// O aviso só EXPLICA: nada aqui liga o serviço no online nem cria vínculo.
// `onlineBookingActive` do profissional não vem na listagem e não tem
// controle na tela (todo profissional nasce ligado); por isso a conta usa
// "profissional ativo que realiza o serviço".

export type MotivoForaDoOnline = "desligado_no_online" | "sem_profissional";

export function motivoForaDoOnline(
  servico: { id: string; active: boolean; activeInPublicBooking: boolean },
  profissionais: readonly { active: boolean; services: readonly { serviceId: string }[] }[],
): MotivoForaDoOnline | null {
  // Inativo já aparece como "Inativo" no cartão; não é oferecido em lugar nenhum.
  if (!servico.active) return null;
  if (!servico.activeInPublicBooking) return "desligado_no_online";
  const realizado = profissionais.some((p) => p.active && p.services.some((v) => v.serviceId === servico.id));
  return realizado ? null : "sem_profissional";
}
