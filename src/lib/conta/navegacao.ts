// Navegação da área REAL (`/conta`) — regras puras, sem React, para serem
// testadas sem montar componente (não há testing-library neste projeto).
//
// Só rotas reais existentes. Nada aqui aponta para `/painel`, `/master` ou
// `/profissional`, que são a demonstração movida por dados locais.

export interface ItemNavegacaoConta {
  href: string;
  rotulo: string;
  /** No celular, a barra inferior só comporta quatro áreas com rótulo legível
   * e área de toque confortável; as demais ficam no menu "Mais". No
   * computador todas aparecem no menu lateral. */
  noCelular: "barra" | "mais";
}

/** Ordem pensada para o dia a dia: o resumo do dia, depois a agenda, que é o
 * que se abre mais vezes, e os clientes, procurados na hora de agendar.
 * "Minha conta" fica por último. */
export const ITENS_NAVEGACAO_CONTA: readonly ItemNavegacaoConta[] = [
  { href: "/conta/visao-geral", rotulo: "Visão geral", noCelular: "barra" },
  { href: "/conta/agendamentos", rotulo: "Agenda", noCelular: "barra" },
  // Pedidos do agendamento online e reservas aguardando confirmação. No
  // celular fica no "Mais", que mostra o contador de pendentes.
  { href: "/conta/solicitacoes", rotulo: "Solicitações", noCelular: "mais" },
  { href: "/conta/clientes", rotulo: "Clientes", noCelular: "barra" },
  { href: "/conta/servicos", rotulo: "Serviços", noCelular: "barra" },
  { href: "/conta/profissionais", rotulo: "Profissionais", noCelular: "mais" },
  { href: "/conta", rotulo: "Minha conta", noCelular: "mais" },
];

/** Itens que, no celular, ficam atrás do botão "Mais". */
export const ITENS_MENU_MAIS: readonly ItemNavegacaoConta[] = ITENS_NAVEGACAO_CONTA.filter(
  (item) => item.noCelular === "mais",
);

/**
 * O item corresponde à página atual?
 *
 * "Minha conta" (`/conta`) só é ativo na própria página — senão ficaria
 * marcado em toda a área. Os demais também valem para as subpáginas
 * (`/conta/profissionais/{id}/horarios` continua em "Profissionais").
 */
export function itemAtivo(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const atual = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (href === "/conta") return atual === "/conta";
  return atual === href || atual.startsWith(`${href}/`);
}

/** Nome acessível do sino do cabeçalho. Sem lista carregada (`null`), não
 * afirma número nenhum. */
export function rotuloDoSino(pendentes: number | null): string {
  if (pendentes === null) return "Notificações";
  if (pendentes === 0) return "Notificações: nenhuma solicitação pendente";
  if (pendentes === 1) return "Notificações: 1 solicitação pendente";
  return `Notificações: ${pendentes} solicitações pendentes`;
}
