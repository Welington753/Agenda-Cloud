// Endereços da administração da plataforma, que mora dentro da área REAL
// (`/conta/administracao/**`), com o mesmo menu, cabeçalho e aparência da
// operação do estabelecimento. Regras puras, sem React.
//
// Os endereços antigos (`/administracao/**`, de quando a administração tinha
// um menu próprio) continuam funcionando: o next.config.ts encaminha para cá,
// preservando a busca. Um link salvo ou o `/login?next=/administracao` não
// quebram.

export const ROTA_ADMINISTRACAO = "/conta/administracao";
export const ROTA_ESTABELECIMENTOS_ADMINISTRADOS = `${ROTA_ADMINISTRACAO}/estabelecimentos`;

/** Ficha de um estabelecimento. Consultá-la nunca troca o estabelecimento
 * ativo da sessão nem cria vínculo: o id só vai para a leitura de plataforma. */
export function rotaFichaEstabelecimento(id: string): string {
  return `${ROTA_ESTABELECIMENTOS_ADMINISTRADOS}/${encodeURIComponent(id)}`;
}

export const ROTA_USUARIOS = `${ROTA_ADMINISTRACAO}/usuarios`;
export const ROTA_CONVITES = `${ROTA_ADMINISTRACAO}/convites`;
export const ROTA_PAPEIS = `${ROTA_ADMINISTRACAO}/papeis`;
export const ROTA_HISTORICO = `${ROTA_ADMINISTRACAO}/historico`;
export const ROTA_NOVO_ESTABELECIMENTO = `${ROTA_ESTABELECIMENTOS_ADMINISTRADOS}/novo`;

export function rotaFichaUsuario(id: string): string {
  return `${ROTA_USUARIOS}/${encodeURIComponent(id)}`;
}

/** Seções da administração, na ordem das abas. */
export const SECOES_ADMINISTRACAO: readonly { href: string; rotulo: string }[] = [
  { href: ROTA_ESTABELECIMENTOS_ADMINISTRADOS, rotulo: "Estabelecimentos" },
  { href: ROTA_USUARIOS, rotulo: "Usuários" },
  { href: ROTA_CONVITES, rotulo: "Convites" },
  { href: ROTA_PAPEIS, rotulo: "Papéis e permissões" },
  { href: ROTA_HISTORICO, rotulo: "Histórico" },
];

export function secaoAtiva(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A página atual é da administração da plataforma? */
export function emAdministracao(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === ROTA_ADMINISTRACAO || pathname.startsWith(`${ROTA_ADMINISTRACAO}/`);
}

/** Encaminhamentos temporários (307), no formato do `redirects()` do
 * next.config.ts. A entrada da seção vai direto para a lista ainda no
 * servidor: o `redirect()` da página só rodaria depois do portão de acesso,
 * e quem não tem acesso ficaria num endereço que não existe de verdade. */
export const ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA = [
  {
    source: "/administracao",
    destination: ROTA_ESTABELECIMENTOS_ADMINISTRADOS,
    permanent: false,
  },
  {
    source: ROTA_ADMINISTRACAO,
    destination: ROTA_ESTABELECIMENTOS_ADMINISTRADOS,
    permanent: false,
  },
  {
    source: "/administracao/:caminho+",
    destination: `${ROTA_ADMINISTRACAO}/:caminho+`,
    permanent: false,
  },
] as const;
