// Endereços da área REAL (`/conta/**`). Regras puras, sem React.
//
// Organização (ver docs/plans/operacao-diaria-configuracoes.md):
// - Início, Agenda (com a aba Solicitações), Clientes e Configurações para o
//   dono;
// - Minha agenda para o funcionário;
// - Configurações em subpáginas: as do estabelecimento só para o dono; as
//   pessoais (Aparência, Perfil e segurança) para todos.
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

export const ROTA_CONFIGURACOES = "/conta/configuracoes";
export const ROTA_CONFIG_ESTABELECIMENTO = `${ROTA_CONFIGURACOES}/estabelecimento`;
export const ROTA_SERVICOS = `${ROTA_CONFIGURACOES}/servicos`;
export const ROTA_PROFISSIONAIS = `${ROTA_CONFIGURACOES}/profissionais`;
export const ROTA_EQUIPE = `${ROTA_CONFIGURACOES}/equipe`;
export const ROTA_NOTIFICACOES = `${ROTA_CONFIGURACOES}/notificacoes`;
export const ROTA_APARENCIA = `${ROTA_CONFIGURACOES}/aparencia`;
export const ROTA_PERFIL = `${ROTA_CONFIGURACOES}/perfil`;

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

export interface SecaoDeConfiguracoes {
  href: string;
  rotulo: string;
  descricao: string;
  alcance: AlcanceDaSecao;
}

/** Seções na ordem da tela. */
export const SECOES_CONFIGURACOES: readonly SecaoDeConfiguracoes[] = [
  {
    href: ROTA_CONFIG_ESTABELECIMENTO,
    rotulo: "Estabelecimento",
    descricao: "Plano, uso, agendamento online e primeiros passos.",
    alcance: "estabelecimento",
  },
  {
    href: ROTA_SERVICOS,
    rotulo: "Serviços",
    descricao: "O que você atende, com duração e preço.",
    alcance: "estabelecimento",
  },
  {
    href: ROTA_PROFISSIONAIS,
    rotulo: "Profissionais",
    descricao: "Quem atende, os serviços e os horários de cada um.",
    alcance: "estabelecimento",
  },
  {
    href: ROTA_EQUIPE,
    rotulo: "Equipe e acessos",
    descricao: "Logins da equipe, vagas do plano e permissões.",
    alcance: "estabelecimento",
  },
  {
    href: ROTA_NOTIFICACOES,
    rotulo: "Notificações",
    descricao: "Avisos de novas solicitações neste aparelho e som.",
    alcance: "estabelecimento",
  },
  {
    href: ROTA_APARENCIA,
    rotulo: "Aparência",
    descricao: "Claro, escuro ou seguir o aparelho.",
    alcance: "pessoal",
  },
  {
    href: ROTA_PERFIL,
    rotulo: "Perfil e segurança",
    descricao: "Sua identificação, senha e saída do sistema.",
    alcance: "pessoal",
  },
];

/** Seções que esta pessoa usa: o dono vê todas; os demais, só as pessoais. */
export function secoesDisponiveis(ehDonoComEstabelecimento: boolean): readonly SecaoDeConfiguracoes[] {
  return ehDonoComEstabelecimento
    ? SECOES_CONFIGURACOES
    : SECOES_CONFIGURACOES.filter((secao) => secao.alcance === "pessoal");
}

/** A página é uma seção de Configurações só do estabelecimento? */
export function emSecaoDoEstabelecimento(pathname: string): boolean {
  return SECOES_CONFIGURACOES.some(
    (secao) =>
      secao.alcance === "estabelecimento" && (pathname === secao.href || pathname.startsWith(`${secao.href}/`)),
  );
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
