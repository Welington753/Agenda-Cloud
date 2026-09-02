// Modelos de domínio do núcleo de agendamento. O núcleo (motor de disponibilidade,
// repositórios, contexto de tenant) é agnóstico de nicho — barbearia, salão, clínica
// etc. são apenas configuração (categoria + terminologia + identidade visual) sobre
// as mesmas entidades genéricas. Toda entidade pertencente a um estabelecimento
// carrega `tenantId` para permitir isolamento multi-tenant (mesmo com dados simulados).

export type CodigoPlano = "essencial" | "equipe" | "pro";
export type StatusEstabelecimento = "teste" | "ativo" | "suspenso" | "inadimplente" | "cancelado";

/** Vertical/nicho do estabelecimento. Serve só para escolher terminologia e
 * comportamento via configuração — nunca deve virar `if (categoria === "barbearia")`
 * espalhado pelos componentes. Veja `src/lib/verticals/terminologia.ts`. */
export type CategoriaNegocio =
  | "barbearia"
  | "salao_beleza"
  | "clinica"
  | "clinica_odontologica"
  | "estetica"
  | "tatuagem"
  | "petshop"
  | "outro";

/** Identidade visual e institucional do estabelecimento. A página pública e o
 * painel nunca devem usar valores fixos de uma demonstração específica — sempre
 * lêem daqui. */
/** Modelo reutilizável de página pública — não existe código separado por
 * estabelecimento, os dois modelos consomem exatamente os mesmos dados
 * (`estabelecimento`, `servicos`, `profissionais`). Ver `src/components/publico/`. */
export type ModeloPaginaPublica = "classico" | "moderno";

export interface IdentidadeVisual {
  nome: string;
  nomeCurto: string;
  logoIniciais: string;
  corPrincipal: string;
  corSecundaria: string;
  corDestaque: string;
  /** Rótulo livre de estilo/tema (ex.: "sofisticado", "clínico-moderno"), usado só
   * como metadado hoje — não há lógica condicional baseada nele. */
  estilo: string;
  modelo: ModeloPaginaPublica;
  endereco: string;
  telefone: string;
  /** E-mail de contato público do negócio — separado do e-mail de login do dono. */
  email?: string;
  redesSociais?: { instagram?: string; facebook?: string };
  textoApresentacao: string;
  /** URLs de fotos — aceita link `https://` ou Data URL de imagem (upload local
   * de demonstração, ver `validarUrlFoto`). */
  fotos: string[];
  bannerUrl?: string;
  /** Logo do estabelecimento. Nesta fase, sem backend/storage, é uma Data URL
   * gerada no upload local (ver `/painel/personalizacao`) — guardada só neste
   * navegador. Preparado para, no futuro, virar uma URL de armazenamento real
   * sem mudar o tipo. Ausente = usa `logoIniciais` como fallback. */
  logoUrl?: string;
  /** Só tem efeito visual quando o plano do tenant inclui `personalizacaoAvancada`. */
  personalizacaoAvancada?: {
    ordemSecoes: ("servicos" | "equipe" | "apresentacao" | "fotos")[];
    rodapePersonalizado?: string;
    ocultarMarcaPlataforma: boolean;
  };
}

/** Funcionalidade contratável. Controla o que aparece no plano (`DefinicaoPlano`)
 * e o que o master pode desativar por exceção em `Estabelecimento.featuresDesativadas`.
 * Algumas (`listaDeEspera`, `comissoes`, `pagamentos`, `assinaturas`, `dominioProprio`)
 * existem só como toggle "em breve" — não há implementação real por trás. */
export type Feature =
  | "agenda"
  | "agendamentoPublico"
  | "profissionais"
  | "consumidores"
  | "relatorios"
  | "equipe"
  | "personalizacaoAvancada"
  | "multiplasUnidades"
  | "dominioProprio"
  | "listaDeEspera"
  | "comissoes"
  | "pagamentos"
  | "assinaturas";

/** Política de agendamento do estabelecimento (o "BookingPolicy" da plataforma).
 * O campo na raiz de `Estabelecimento` continua se chamando `regras` por
 * consistência com o restante do código em português — este é o tipo nomeado que
 * lhe dá forma. O motor de disponibilidade só conhece os 3 primeiros campos. */
export interface RegrasAgendamento {
  antecedenciaMinimaMinutos: number;
  limiteDiasFuturos: number;
  prazoCancelamentoHoras: number;
  confirmacaoAutomatica: boolean;
  permitirQualquerProfissional: boolean;
  permitirRemarcacaoCliente: boolean;
  exigirTelefoneCliente: boolean;
  /** Modelado para evolução futura; o formulário de agendamento ainda não coleta
   * e-mail nesta fase (ver limitações no plano de refatoração). */
  exigirEmailCliente: boolean;
  exibirPrecoPublico: boolean;
  intervaloPadraoMinutos: number;
  /** Texto livre opcional mostrado na página pública antes da confirmação —
   * ex.: "chegue com 5 min de antecedência". Renderizado sempre como texto
   * simples, nunca como HTML. */
  orientacoesAntesVisita?: string;
}

export interface Estabelecimento {
  id: string;
  tenantId: string;
  slug: string;
  categoria: CategoriaNegocio;
  identidadeVisual: IdentidadeVisual;
  /** CNPJ ou CPF — puramente cadastral, nunca usado como identificador técnico. */
  documentoFiscal?: string;
  /** Capturado no cadastro do estabelecimento; nesta fase é só metadado — todo o
   * app calcula horários no fuso do navegador de quem está usando. */
  fusoHorario: string;
  horarioGeral: { diasFuncionamento: DiaSemana[]; abertura: string; fechamento: string };
  regras: RegrasAgendamento;
  plano: CodigoPlano;
  /** Exceções do master REMOVENDO uma feature que o plano incluiria. Não existe
   * exceção de adicionar uma feature fora do plano nesta fase. */
  featuresDesativadas: Feature[];
  limites: { maxProfissionais: number; maxUnidades: number };
  status: StatusEstabelecimento;
  /** Preenchido só quando `status === "suspenso"`; limpo ao reativar. */
  motivoSuspensao?: string;
  criadoEm: string;
  quantidadeProfissionais: number;
}

export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domingo

export interface HorarioDia {
  diaSemana: DiaSemana;
  ativo: boolean;
  inicio: string; // "09:00"
  fim: string; // "19:00"
  almocoInicio?: string;
  almocoFim?: string;
}

/** Unidade física do estabelecimento. Hoje cada tenant tem uma única unidade
 * principal semeada; nenhuma tela filtra por unidade ainda
 * (`funcionalidades.multiplasUnidades` fica `false`). */
export interface Unidade {
  id: string;
  tenantId: string;
  nome: string;
  endereco: string;
  principal: boolean;
}

export type TipoRecurso = "cadeira" | "sala" | "consultorio" | "equipamento" | "mesa" | "veiculo" | "outro";

/** Recurso físico opcional (cadeira, sala, consultório, equipamento...). Existe só
 * no domínio e nos dados simulados nesta fase: o motor de disponibilidade ainda
 * não verifica conflito de recursos — bloqueio simultâneo de recursos é
 * funcionalidade futura. */
export interface Recurso {
  id: string;
  tenantId: string;
  nome: string;
  tipo: TipoRecurso;
  ativo: boolean;
}

export interface Bloqueio {
  id: string;
  tenantId: string;
  profissionalId: string;
  inicio: string; // ISO
  fim: string; // ISO
  motivo: string;
}

export interface Profissional {
  id: string;
  tenantId: string;
  /** Opcional e não filtrado nesta fase — preparação para múltiplas unidades. */
  unidadeId?: string;
  nome: string;
  avatarIniciais: string;
  corAvatar: string;
  servicosIds: string[];
  horarios: HorarioDia[];
  agendamentoOnlineAtivo: boolean;
  ativo: boolean;
}

export type ModalidadeAtendimento = "presencial" | "remoto" | "domiciliar";

export interface Servico {
  id: string;
  tenantId: string;
  nome: string;
  descricaoCurta: string;
  /** Ausente = sem preço definido ("sob consulta"). Ver `precoVisivel` e
   * `formatarPrecoPublico` para a regra de exibição pública. */
  precoCentavos?: number;
  /** `false` oculta o preço nas telas públicas mesmo quando `precoCentavos` existe
   * (ex.: avaliação com valor interno de referência, mas divulgado como "sob
   * consulta"). O painel do dono sempre vê o valor real. */
  precoVisivel: boolean;
  duracaoMinutos: number;
  intervaloPosteriorMinutos: number;
  modalidade: ModalidadeAtendimento;
  profissionaisIds: string[];
  ativoNoAgendamentoPublico: boolean;
  /** Quando `true`, um agendamento público nunca nasce "confirmado" para este
   * serviço mesmo que a política do estabelecimento seja de confirmação
   * automática. Modelado para evolução futura; ainda não aplicado no fluxo. */
  exigeConfirmacaoManual: boolean;
  ativo: boolean;
}

/** A pessoa que agenda um atendimento — nunca faz login, nunca acessa o portal
 * privado. Renomeado de "Cliente" para "Consumidor" para não colidir com
 * `UsuarioEstabelecimento` (a equipe que trabalha no tenant). */
export interface Consumidor {
  id: string;
  tenantId: string;
  nome: string;
  whatsapp: string;
  /** Modelado para evolução futura — o formulário de agendamento ainda não coleta
   * e-mail nesta fase. */
  email?: string;
  totalVisitas: number;
  totalFaltas: number;
  ultimoAtendimentoEm?: string;
  proximoAgendamentoEm?: string;
}

export type StatusAgendamento =
  | "pendente"
  | "confirmado"
  | "em_atendimento"
  | "concluido"
  | "cancelado"
  | "nao_compareceu";

export interface HistoricoAlteracao {
  em: string;
  de: StatusAgendamento | "criado";
  para: StatusAgendamento;
  por: string;
}

export interface Agendamento {
  id: string;
  tenantId: string;
  consumidorId: string;
  consumidorNome: string;
  consumidorWhatsapp: string;
  profissionalId: string;
  servicoId: string;
  dataHoraInicio: string; // ISO
  dataHoraFim: string; // ISO
  status: StatusAgendamento;
  /** Cópia do preço no momento do agendamento; ausente quando o serviço não tem
   * preço definido ("sob consulta"). */
  precoCentavos?: number;
  observacoes?: string;
  criadoEm: string;
  historico: HistoricoAlteracao[];
}

export type TipoComissao = "percentual" | "fixo";

/** `confirmado` = lançamento válido, entra nos totais do relatório. `estornado` =
 * o agendamento que o gerou foi revertido depois de concluído; o registro nunca é
 * apagado, só marcado — histórico permanece auditável. */
export type StatusLancamentoComissao = "confirmado" | "estornado";

/** Regra de comissão para UMA combinação profissional+serviço. No máximo uma por
 * `tenantId`+`profissionalId`+`servicoId` — `comissaoRegraRepository.salvar` faz
 * upsert por essa chave, então a unicidade é estrutural, não uma checagem separada.
 * `valor`: percentual é 0-100 (não fração); fixo é centavos. */
export interface RegraComissao {
  id: string;
  tenantId: string;
  profissionalId: string;
  servicoId: string;
  tipo: TipoComissao;
  valor: number;
  criadoEm: string;
  atualizadoEm: string;
}

/** Lançamento gerado quando um agendamento é concluído — cópia congelada dos
 * valores no momento do cálculo. Nunca é recalculado a partir da regra atual;
 * alterar ou remover a `RegraComissao` depois não toca nenhum `LancamentoComissao`
 * já existente. No máximo um lançamento por `agendamentoId`, para sempre — se o
 * agendamento for revertido e concluído de novo, o MESMO registro é reativado
 * (status volta a `confirmado`, `reativadoEm` é preenchido), nunca criada uma
 * segunda linha nem recalculados os valores. */
export interface LancamentoComissao {
  id: string;
  tenantId: string;
  agendamentoId: string;
  profissionalId: string;
  servicoId: string;
  precoAgendamentoCentavos: number;
  tipoComissao: TipoComissao;
  valorRegraAplicada: number;
  valorProfissionalCentavos: number;
  valorEstabelecimentoCentavos: number;
  /** = `Agendamento.dataHoraInicio` no momento do cálculo. */
  dataAtendimento: string;
  calculadoEm: string;
  status: StatusLancamentoComissao;
  /** Preenchido só quando o lançamento é reativado depois de ter sido estornado —
   * ausente em registros que nunca passaram por reversão. Opcional para não exigir
   * migração de lançamentos antigos. */
  reativadoEm?: string;
}

// ---------------------------------------------------------------------------
// Contas, vínculos e permissões
//
// Três tipos de "pessoa" bem separados, de propósito:
//   UsuarioPlataforma      — administra o SaaS (nunca vê dados de um tenant específico
//                             a não ser via acesso de suporte auditado).
//   UsuarioEstabelecimento — trabalha em um (ou, arquiteturalmente, mais de um)
//                             tenant; o papel e as permissões vivem no `Membership`,
//                             não na pessoa, para não travar múltiplos vínculos futuros.
//   Consumidor             — definido acima; nunca faz login.
// ---------------------------------------------------------------------------

export type PapelPlataforma = "MASTER_OWNER" | "MASTER_ADMIN" | "MASTER_SUPPORT";
export type PapelEstabelecimento = "dono" | "gerente" | "recepcionista" | "profissional";

/** "convidado" = convite aceito e usuário criado, mas nunca seria o status de um
 * convite em si (isso é `StatusConvite`) — é o estado da CONTA antes do primeiro
 * acesso, útil para diferenciar de "ativo" nas listagens. */
export type StatusUsuario = "ativo" | "suspenso" | "convidado";

export interface UsuarioPlataforma {
  id: string;
  nome: string;
  email: string;
  papel: PapelPlataforma;
  status: StatusUsuario;
  /** Só usado quando `papel === "MASTER_ADMIN"` — MASTER_OWNER tem tudo, MASTER_SUPPORT
   * tem o padrão limitado de suporte a menos que ganhe extras aqui também. */
  permissoesExtras: PermissaoPlataforma[];
  criadoEm: string;
  ultimoAcessoSimuladoEm?: string;
}

export interface UsuarioEstabelecimento {
  id: string;
  nome: string;
  email: string;
  telefone?: string;
  status: StatusUsuario;
  criadoEm: string;
  ultimoAcessoSimuladoEm?: string;
}

/** Vínculo de um `UsuarioEstabelecimento` com um tenant. É aqui — não na pessoa —
 * que vivem o papel e os ajustes individuais de permissão. */
export interface Membership {
  id: string;
  usuarioId: string;
  tenantId: string;
  papel: PapelEstabelecimento;
  /** Presente quando `papel === "profissional"`, aponta para o registro `Profissional`
   * que representa essa pessoa na agenda. */
  profissionalId?: string;
  /** Concede permissões além do padrão do papel. */
  permissoesLiberadas: Permission[];
  /** Nega mesmo que o papel/plano permitiriam — sempre vence sobre os outros passos
   * do cálculo de acesso (ver `src/lib/access/access-control.ts`). */
  permissoesNegadas: Permission[];
  criadoEm: string;
}

export type Permission =
  | "dashboard.visualizar"
  | "agenda.visualizar"
  | "agenda.gerenciar"
  | "agendamento.criar"
  | "agendamento.editar"
  | "agendamento.cancelar"
  | "profissionais.visualizar"
  | "profissionais.gerenciar"
  | "servicos.visualizar"
  | "servicos.gerenciar"
  | "consumidores.visualizar"
  | "consumidores.gerenciar"
  | "relatorios.visualizar"
  | "equipe.visualizar"
  | "equipe.gerenciar"
  | "comissoes.visualizar"
  | "comissoes.gerenciar"
  | "personalizacao.gerenciar"
  | "configuracoes.gerenciar";

/** Permissões de administração da própria plataforma (distintas de `Permission`,
 * que é do domínio de um tenant — ver nota em access-control.ts sobre por que
 * não são a mesma função de cálculo). */
export type PermissaoPlataforma =
  | "estabelecimentos.gerenciar"
  | "administradores.gerenciar"
  | "planos.gerenciar"
  | "suporte.acessar";

export type TipoConvite = "estabelecimento" | "plataforma";
export type StatusConvite = "pendente" | "aceito" | "expirado" | "revogado";

/** Convite simulado — não há e-mail real. "Aceitar" é uma ação disponível na
 * própria tela de demonstração (ver `/master/administradores` e `/painel/equipe`),
 * deixando claro que substituirá um fluxo de e-mail real no futuro. */
export interface Convite {
  id: string;
  tipo: TipoConvite;
  nome: string;
  email: string;
  /** Presente quando `tipo === "estabelecimento"`. */
  tenantId?: string;
  papel: PapelEstabelecimento | PapelPlataforma;
  status: StatusConvite;
  token: string;
  criadoEm: string;
  expiraEm: string;
  aceitoEm?: string;
  /** Preenchido com o id do `UsuarioEstabelecimento`/`UsuarioPlataforma` gerado
   * quando o convite é aceito. */
  usuarioIdGerado?: string;
}

export type AcaoAuditoria =
  | "tenant.criado"
  | "tenant.plano_alterado"
  | "tenant.feature_alterada"
  | "tenant.suspenso"
  | "tenant.reativado"
  | "master.criado"
  | "master.removido"
  | "usuario.convidado"
  | "usuario.permissao_alterada"
  | "suporte.acessado"
  | "identidade.alterada";

/** Log somente-leitura de ações sensíveis. Local (mesmo `localStorage`) nesta
 * fase — não é um log imutável de servidor. Nunca registra senha ou dado sensível. */
export interface RegistroAuditoria {
  id: string;
  em: string;
  acao: AcaoAuditoria;
  usuarioResponsavelId: string;
  usuarioResponsavelNome: string;
  tenantId?: string;
  resumo: string;
  dadosAnteriores?: Record<string, unknown>;
  dadosPosteriores?: Record<string, unknown>;
}

/** Sessão simulada — cobre tanto um administrador de plataforma quanto um
 * usuário de estabelecimento num único formato, distinguidos por `escopo`.
 * É isto que uma autenticação real (JWT/cookie de sessão) substituiria; ver
 * `src/lib/auth/auth-context.tsx`. */
export interface SessaoUsuario {
  id: string;
  nome: string;
  email: string;
  escopo: "plataforma" | "estabelecimento";
  papel: PapelPlataforma | PapelEstabelecimento;
  /** Presente só quando `escopo === "estabelecimento"` — o tenant SEMPRE vem da
   * sessão, nunca de um parâmetro de URL ou formulário. */
  tenantId?: string;
  membershipId?: string;
  /** Presente quando `papel === "profissional"`. */
  profissionalId?: string;
}
