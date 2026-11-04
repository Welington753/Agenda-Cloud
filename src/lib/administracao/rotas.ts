// Endereços do portal da plataforma, uma área PRÓPRIA (`/portal/**`), com
// entrada (login próprio em `/portal`), layout e navegação separados da
// operação dos estabelecimentos (`/conta/**`). A operação não tem atalho
// nenhum para cá, nem para quem também é proprietário. Regras puras, sem
// React.
//
// Mudar o endereço não autoriza nada: cada leitura e escrita do portal é
// recusada no servidor para quem não é proprietário da plataforma
// (backend/src/platform/platform-access.ts).
//
// Os endereços antigos (`/plataforma/**`, `/administracao/**` e
// `/conta/administracao/**`) continuam funcionando: o next.config.ts
// encaminha para cá, preservando a busca. O destino passa pela mesma entrada
// e pelo mesmo portão do portal, então ninguém sem acesso vê dado nenhum.

export const ROTA_ADMINISTRACAO = "/portal";
/** Destino padrão depois da entrada do portal. */
export const ROTA_VISAO_GERAL = `${ROTA_ADMINISTRACAO}/visao-geral`;
export const ROTA_ESTABELECIMENTOS_ADMINISTRADOS = `${ROTA_ADMINISTRACAO}/estabelecimentos`;

/** Lista de estabelecimentos já filtrada (links da Visão geral). Os nomes dos
 * parâmetros são os que a listagem lê ao abrir. */
export function rotaEstabelecimentosFiltrados(filtro: { filtro?: string; situacao?: string }): string {
  const params = new URLSearchParams();
  if (filtro.filtro) params.set("filtro", filtro.filtro);
  if (filtro.situacao) params.set("situacao", filtro.situacao);
  const busca = params.toString();
  return busca ? `${ROTA_ESTABELECIMENTOS_ADMINISTRADOS}?${busca}` : ROTA_ESTABELECIMENTOS_ADMINISTRADOS;
}

/** Ficha de um estabelecimento. Consultá-la nunca troca o estabelecimento
 * ativo da sessão nem cria vínculo: o id só vai para a leitura de plataforma. */
export function rotaFichaEstabelecimento(id: string): string {
  return `${ROTA_ESTABELECIMENTOS_ADMINISTRADOS}/${encodeURIComponent(id)}`;
}

export const ROTA_USUARIOS = `${ROTA_ADMINISTRACAO}/usuarios`;
export const ROTA_CONVITES = `${ROTA_ADMINISTRACAO}/convites`;
export const ROTA_PAPEIS = `${ROTA_ADMINISTRACAO}/papeis`;
export const ROTA_HISTORICO = `${ROTA_ADMINISTRACAO}/historico`;
export const ROTA_PLANOS_E_PRECOS = `${ROTA_ADMINISTRACAO}/planos`;
export const ROTA_PAGAMENTOS_ASSINATURAS = `${ROTA_ADMINISTRACAO}/pagamentos`;
export const ROTA_NOVO_ESTABELECIMENTO = `${ROTA_ESTABELECIMENTOS_ADMINISTRADOS}/novo`;

export function rotaFichaUsuario(id: string): string {
  return `${ROTA_USUARIOS}/${encodeURIComponent(id)}`;
}

/** Seções do portal, na ordem do menu. */
export const SECOES_ADMINISTRACAO: readonly { href: string; rotulo: string }[] = [
  { href: ROTA_VISAO_GERAL, rotulo: "Visão geral" },
  { href: ROTA_ESTABELECIMENTOS_ADMINISTRADOS, rotulo: "Estabelecimentos" },
  { href: ROTA_USUARIOS, rotulo: "Responsáveis e acessos" },
  { href: ROTA_CONVITES, rotulo: "Convites" },
  { href: ROTA_PLANOS_E_PRECOS, rotulo: "Planos e preços" },
  { href: ROTA_PAGAMENTOS_ASSINATURAS, rotulo: "Pagamentos das assinaturas" },
  { href: ROTA_PAPEIS, rotulo: "Proprietários da plataforma" },
  { href: ROTA_HISTORICO, rotulo: "Histórico administrativo" },
];

export function secaoAtiva(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A página atual é do portal da plataforma? */
export function emAdministracao(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === ROTA_ADMINISTRACAO || pathname.startsWith(`${ROTA_ADMINISTRACAO}/`);
}

/** Destino depois da entrada do portal: um `next` (já sanitizado, ver
 * lib/auth/safe-redirect.ts) que aponte para DENTRO do portal, ou a Visão
 * geral. Um `next` da operação nunca é seguido a partir daqui, e a própria
 * entrada não vira destino (voltaria para o formulário). */
export function destinoNoPortal(next: string | null): string {
  const caminho = next?.split(/[?#]/)[0] ?? null;
  if (next && caminho !== ROTA_ADMINISTRACAO && emAdministracao(caminho)) return next;
  return ROTA_VISAO_GERAL;
}

/** Endereço da entrada do portal que, depois do login, volta para `atual`. */
export function entradaDoPortal(atual: string | null): string {
  if (!atual || destinoNoPortal(atual) !== atual) return ROTA_ADMINISTRACAO;
  return `${ROTA_ADMINISTRACAO}?next=${encodeURIComponent(atual)}`;
}

/** Encaminhamentos temporários (307), no formato do `redirects()` do
 * next.config.ts. Todos levam à entrada (`/portal`) ou à mesma página dentro
 * do portal: sem sessão, ela pede o login do portal; com a sessão de quem não
 * é proprietário, o portão recusa antes de ler qualquer dado. */
export const ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA = [
  { source: "/plataforma", destination: ROTA_ADMINISTRACAO, permanent: false },
  { source: "/plataforma/:caminho+", destination: `${ROTA_ADMINISTRACAO}/:caminho+`, permanent: false },
  { source: "/administracao", destination: ROTA_ADMINISTRACAO, permanent: false },
  { source: "/administracao/:caminho+", destination: `${ROTA_ADMINISTRACAO}/:caminho+`, permanent: false },
  { source: "/conta/administracao", destination: ROTA_ADMINISTRACAO, permanent: false },
  { source: "/conta/administracao/:caminho+", destination: `${ROTA_ADMINISTRACAO}/:caminho+`, permanent: false },
] as const;
