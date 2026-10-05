// Navegação da área REAL (`/conta`) — regras puras, sem React, para serem
// testadas sem montar componente (não há testing-library neste projeto).
//
// Só rotas reais existentes. Nada aqui aponta para `/painel`, `/master` ou
// `/profissional`, que são a demonstração movida por dados locais.

export interface ItemNavegacaoConta {
  href: string;
  rotulo: string;
}

/** Ordem pensada para o dia a dia: a agenda é o que se abre mais vezes. */
export const ITENS_NAVEGACAO_CONTA: readonly ItemNavegacaoConta[] = [
  { href: "/conta/agendamentos", rotulo: "Agenda" },
  { href: "/conta/servicos", rotulo: "Serviços" },
  { href: "/conta/profissionais", rotulo: "Profissionais" },
  { href: "/conta", rotulo: "Minha conta" },
];

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
