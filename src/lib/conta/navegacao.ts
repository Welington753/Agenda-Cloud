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
