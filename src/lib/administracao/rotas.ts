// Endereços do portal da plataforma, uma área PRÓPRIA (`/plataforma/**`),
// com entrada, layout e navegação separados da operação dos
// estabelecimentos (`/conta/**`). Regras puras, sem React.
//
// Mudar o endereço não autoriza nada: cada leitura e escrita do portal é
// recusada no servidor para quem não é proprietário da plataforma
// (backend/src/platform/platform-access.ts).
//
// Os endereços antigos (`/administracao/**`, do primeiro menu próprio, e
// `/conta/administracao/**`, de quando a administração morava na área da
// conta) continuam funcionando: o next.config.ts encaminha para cá,
// preservando a busca. Um link salvo ou o `/login?next=...` não quebram.

export const ROTA_ADMINISTRACAO = "/plataforma";
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
export const ROTA_PLANOS_E_PRECOS = `${ROTA_ADMINISTRACAO}/planos`;
export const ROTA_PAGAMENTOS_ASSINATURAS = `${ROTA_ADMINISTRACAO}/pagamentos`;
export const ROTA_NOVO_ESTABELECIMENTO = `${ROTA_ESTABELECIMENTOS_ADMINISTRADOS}/novo`;

export function rotaFichaUsuario(id: string): string {
  return `${ROTA_USUARIOS}/${encodeURIComponent(id)}`;
}

/** Seções do portal, na ordem do menu. */
export const SECOES_ADMINISTRACAO: readonly { href: string; rotulo: string }[] = [
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

/** Encaminhamentos temporários (307), no formato do `redirects()` do
 * next.config.ts. A entrada vai direto para a lista ainda no servidor: o
 * `redirect()` da página só rodaria depois do portão de acesso, e quem não
 * tem acesso ficaria num endereço que não existe de verdade. */
export const ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA = [
  {
    source: ROTA_ADMINISTRACAO,
    destination: ROTA_ESTABELECIMENTOS_ADMINISTRADOS,
    permanent: false,
  },
  {
    source: "/administracao",
    destination: ROTA_ESTABELECIMENTOS_ADMINISTRADOS,
    permanent: false,
  },
  {
    source: "/administracao/:caminho+",
    destination: `${ROTA_ADMINISTRACAO}/:caminho+`,
    permanent: false,
  },
  {
    source: "/conta/administracao",
    destination: ROTA_ESTABELECIMENTOS_ADMINISTRADOS,
    permanent: false,
  },
  {
    source: "/conta/administracao/:caminho+",
    destination: `${ROTA_ADMINISTRACAO}/:caminho+`,
    permanent: false,
  },
] as const;
