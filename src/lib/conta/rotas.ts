// Endereços da área REAL (`/conta/**`). Regras puras, sem React.
//
// Organização (ver docs/plans/menu-do-dono-organizado.md):
// - Dashboard, Agenda (com a aba Solicitações), Profissionais, Serviços,
//   Clientes, Equipe e acessos, Comissões (quando o plano inclui) e
//   Configurações para o dono;
// - Minha agenda para o funcionário;
// - Configurações em grupos: os do estabelecimento e o financeiro só para o
//   dono; os pessoais (Aparência, Perfil e segurança) para todos.
//
// Serviços, Profissionais e Equipe e acessos são áreas próprias do menu,
// fora de Configurações, mas continuam nos endereços de antes
// (`/conta/configuracoes/servicos`, `.../profissionais` e `.../equipe`):
// links já compartilhados e os atalhos das outras telas não mudam.
//
// Os endereços antigos continuam funcionando: o next.config.ts encaminha para
// cá, preservando a busca (as notificações já entregues usam
// `/conta/solicitacoes?estabelecimento=…&solicitacao=…`).

export const ROTA_CONTA = "/conta";
export const ROTA_INICIO = "/conta/visao-geral";
export const ROTA_AGENDA = "/conta/agendamentos";
export const ROTA_SOLICITACOES = `${ROTA_AGENDA}/solicitacoes`;
export const ROTA_CLIENTES = "/conta/clientes";
export const ROTA_MINHA_AGENDA = "/conta/minha-agenda";
export const ROTA_SELECIONAR_ESTABELECIMENTO = "/conta/selecionar-estabelecimento";
/** Recebimentos manuais (dono), abertos pelo Dashboard e por Configurações. */
export const ROTA_RECEBIMENTOS = "/conta/recebimentos";
/** Comissões apuradas por profissional (dono, com o recurso no plano). */
export const ROTA_COMISSOES = "/conta/comissoes";
/** As próprias comissões (funcionário, quando o dono libera). */
export const ROTA_MINHAS_COMISSOES = "/conta/minha-agenda/comissoes";

export const ROTA_CONFIGURACOES = "/conta/configuracoes";
export const ROTA_CONFIG_ESTABELECIMENTO = `${ROTA_CONFIGURACOES}/estabelecimento`;
export const ROTA_SERVICOS = `${ROTA_CONFIGURACOES}/servicos`;
export const ROTA_PROFISSIONAIS = `${ROTA_CONFIGURACOES}/profissionais`;
export const ROTA_EQUIPE = `${ROTA_CONFIGURACOES}/equipe`;
export const ROTA_NOTIFICACOES = `${ROTA_CONFIGURACOES}/notificacoes`;
export const ROTA_APARENCIA = `${ROTA_CONFIGURACOES}/aparencia`;
export const ROTA_PERFIL = `${ROTA_CONFIGURACOES}/perfil`;

/** Uma regra geral de comissão para vários profissionais de uma vez (dono). */
export const ROTA_COMISSAO_EM_MASSA = `${ROTA_PROFISSIONAIS}/comissao-em-massa`;

/** Regras de comissão de um profissional, por serviço. */
export function rotaComissoesDoProfissional(id: string): string {
  return `${ROTA_PROFISSIONAIS}/${encodeURIComponent(id)}/comissoes`;
}

export function rotaHorariosDoProfissional(id: string): string {
  return `${ROTA_PROFISSIONAIS}/${encodeURIComponent(id)}/horarios`;
}

export function rotaDisponibilidadeDoProfissional(id: string): string {
  return `${ROTA_PROFISSIONAIS}/${encodeURIComponent(id)}/disponibilidade`;
}

/** Quem usa cada seção de Configurações. "estabelecimento": só o dono, com
 * estabelecimento ativo. "pessoal": qualquer pessoa conectada, inclusive o
 * funcionário e o administrador sem estabelecimento. */
export type AlcanceDaSecao = "estabelecimento" | "pessoal";

/** Assunto da seção: é por ele que o índice de Configurações agrupa. */
export type GrupoDaSecao = "estabelecimento" | "financeiro" | "conta";

export const TITULO_DO_GRUPO: Record<GrupoDaSecao, string> = {
  estabelecimento: "Estabelecimento",
  financeiro: "Financeiro",
  conta: "Sua conta",
};

export interface SecaoDeConfiguracoes {
  href: string;
  rotulo: string;
  descricao: string;
  alcance: AlcanceDaSecao;
  grupo: GrupoDaSecao;
}

/** Seções na ordem da tela, já na ordem dos grupos. Só o que NÃO tem entrada
 * própria no menu do dono: Equipe e acessos saiu daqui quando ganhou a sua
 * (o endereço continua `/conta/configuracoes/equipe`). Recebimentos não tem
 * entrada no menu do dono e fica aqui, além do atalho do Dashboard. */
export const SECOES_CONFIGURACOES: readonly SecaoDeConfiguracoes[] = [
  {
    href: ROTA_CONFIG_ESTABELECIMENTO,
    rotulo: "Estabelecimento",
    descricao: "Plano, uso, agendamento online e primeiros passos.",
    alcance: "estabelecimento",
    grupo: "estabelecimento",
  },
  {
    href: ROTA_NOTIFICACOES,
    rotulo: "Notificações",
    descricao: "Avisos de novas solicitações neste aparelho e som.",
    alcance: "estabelecimento",
    grupo: "estabelecimento",
  },
  {
    href: ROTA_RECEBIMENTOS,
    rotulo: "Recebimentos",
    descricao: "O que foi recebido por atendimento, com registro e estorno.",
    alcance: "estabelecimento",
    grupo: "financeiro",
  },
  {
    href: ROTA_APARENCIA,
    rotulo: "Aparência",
    descricao: "Claro, escuro ou seguir o aparelho.",
    alcance: "pessoal",
    grupo: "conta",
  },
  {
    href: ROTA_PERFIL,
    rotulo: "Perfil e segurança",
    descricao: "Sua identificação, senha e saída do sistema.",
    alcance: "pessoal",
    grupo: "conta",
  },
];

/** Seções que esta pessoa usa: o dono vê todas; os demais, só as pessoais. */
export function secoesDisponiveis(ehDonoComEstabelecimento: boolean): readonly SecaoDeConfiguracoes[] {
  return ehDonoComEstabelecimento
    ? SECOES_CONFIGURACOES
    : SECOES_CONFIGURACOES.filter((secao) => secao.alcance === "pessoal");
}

export interface GrupoDeConfiguracoes {
  grupo: GrupoDaSecao;
  titulo: string;
  secoes: readonly SecaoDeConfiguracoes[];
}

/** As seções reunidas por assunto, na ordem em que aparecem; grupo sem
 * seção para esta pessoa não aparece. */
export function agruparSecoes(secoes: readonly SecaoDeConfiguracoes[]): GrupoDeConfiguracoes[] {
  const grupos: GrupoDeConfiguracoes[] = [];
  for (const secao of secoes) {
    const existente = grupos.find((g) => g.grupo === secao.grupo);
    if (existente) existente.secoes = [...existente.secoes, secao];
    else grupos.push({ grupo: secao.grupo, titulo: TITULO_DO_GRUPO[secao.grupo], secoes: [secao] });
  }
  return grupos;
}

/** Áreas do menu do dono que moram sob `/conta/configuracoes` (endereços
 * mantidos), mas não são seções de Configurações. */
export const AREAS_SOB_CONFIGURACOES: readonly string[] = [ROTA_SERVICOS, ROTA_PROFISSIONAIS, ROTA_EQUIPE];

/** Páginas sob `/conta/configuracoes` que só o dono com estabelecimento
 * usa. Recebimentos fica de fora: tem endereço próprio e também serve ao
 * gerente com a área concedida. */
const SO_DO_DONO_SOB_CONFIGURACOES: readonly string[] = [ROTA_CONFIG_ESTABELECIMENTO, ROTA_NOTIFICACOES];

const dentroDe = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** A página é Serviços, Profissionais ou Equipe e acessos (inclusive
 * subpáginas)? */
export function emAreaSobConfiguracoes(pathname: string): boolean {
  return AREAS_SOB_CONFIGURACOES.some((href) => dentroDe(pathname, href));
}

/** A página é só do dono com estabelecimento: uma seção de Configurações do
 * estabelecimento, Serviços, Profissionais ou Equipe e acessos? */
export function emSecaoDoEstabelecimento(pathname: string): boolean {
  return emAreaSobConfiguracoes(pathname) || SO_DO_DONO_SOB_CONFIGURACOES.some((href) => dentroDe(pathname, href));
}

/** Encaminhamentos temporários (307) dos endereços antigos, no formato do
 * `redirects()` do next.config.ts. A busca da URL é preservada pelo Next. */
export const ENCAMINHAMENTOS_CONTA_ANTIGA = [
  { source: "/conta/solicitacoes", destination: ROTA_SOLICITACOES, permanent: false },
  { source: "/conta/servicos", destination: ROTA_SERVICOS, permanent: false },
  { source: "/conta/profissionais", destination: ROTA_PROFISSIONAIS, permanent: false },
  { source: "/conta/profissionais/:caminho*", destination: `${ROTA_PROFISSIONAIS}/:caminho*`, permanent: false },
  { source: "/conta/equipe", destination: ROTA_EQUIPE, permanent: false },
] as const;
