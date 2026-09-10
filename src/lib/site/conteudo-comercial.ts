// Conteúdo textual da apresentação comercial (site público). Extraído como dados
// puros — sem JSX — para poder ser testado sem renderizar componentes (ver
// conteudo-comercial.test.ts) e para os componentes de `src/components/site/`
// ficarem só de apresentação. Todo texto aqui é original: sem números de clientes,
// depoimentos, avaliações ou promessas de recursos que ainda não existem.

import type { CodigoPlano } from "../types";

export interface ItemNavegacao {
  rotulo: string;
  href: string;
}

export const NAV_SITE: ItemNavegacao[] = [
  { rotulo: "Produto", href: "#produto" },
  { rotulo: "Funcionalidades", href: "#funcionalidades" },
  { rotulo: "Para quem", href: "#para-quem" },
  { rotulo: "Planos", href: "#planos" },
];

export const HREF_ENTRAR = "/login";
export const HREF_TESTAR_GRATIS = "/onboarding";

export interface Segmento {
  id: string;
  rotulo: string;
  exemplo: string;
}

/** Lista deliberadamente ampla — nenhum negócio aparece como o único foco do
 * produto. "outro" fica por último como categoria de saída para o que não
 * está listado, nunca como afterthought de layout. */
export const SEGMENTOS: Segmento[] = [
  { id: "salao-barbearia", rotulo: "Salão e barbearia", exemplo: "cortes, coloração e barba" },
  { id: "estetica", rotulo: "Estética", exemplo: "procedimentos e sessões" },
  { id: "clinica", rotulo: "Clínica e consultório", exemplo: "consultas e procedimentos" },
  { id: "terapeuta", rotulo: "Terapeuta", exemplo: "sessões individuais" },
  { id: "massagem", rotulo: "Massagem", exemplo: "sessões avulsas e pacotes" },
  { id: "pilates-yoga", rotulo: "Pilates e yoga", exemplo: "aulas em horário fixo" },
  { id: "tatuagem", rotulo: "Tatuagem", exemplo: "sessões por projeto" },
  { id: "petshop", rotulo: "Pet shop e banho e tosa", exemplo: "banho, tosa e serviços" },
  { id: "professor-consultor", rotulo: "Professor e consultor", exemplo: "aulas e atendimentos" },
  { id: "outro", rotulo: "Outros serviços com agendamento", exemplo: "qualquer negócio com horário marcado" },
];

export interface Problema {
  id: string;
  titulo: string;
  descricao: string;
}

export const PROBLEMAS: Problema[] = [
  {
    id: "mensagens",
    titulo: "Troca de mensagens para achar horário",
    descricao: "Cliente e negócio perdem tempo combinando data e hora por mensagem antes de fechar um horário.",
  },
  {
    id: "faltas",
    titulo: "Faltas e esquecimentos",
    descricao: "Sem lembrete e sem confirmação, é fácil o cliente esquecer o horário marcado.",
  },
  {
    id: "agenda-dispersa",
    titulo: "Agenda espalhada em papel ou apps soltos",
    descricao: "Horários anotados em lugares diferentes dificultam ver o dia inteiro de uma vez.",
  },
  {
    id: "sem-pagina-propria",
    titulo: "Sem um link próprio para o cliente agendar",
    descricao: "Sem uma página pública, todo agendamento depende de alguém responder manualmente.",
  },
];

export type StatusFuncionalidade = "disponivel" | "em-desenvolvimento";

export interface Funcionalidade {
  id: string;
  rotulo: string;
  descricao: string;
  status: StatusFuncionalidade;
}

/** Só funcionalidades que existem de fato na demonstração local. Nunca liste
 * aqui algo que ainda não tem tela funcionando. */
export const FUNCIONALIDADES_DISPONIVEIS: Funcionalidade[] = [
  { id: "agenda", rotulo: "Agenda", descricao: "Visão do dia com todos os horários e profissionais.", status: "disponivel" },
  { id: "profissionais", rotulo: "Profissionais", descricao: "Cadastro de profissionais e seus horários de trabalho.", status: "disponivel" },
  { id: "servicos", rotulo: "Serviços e duração", descricao: "Cada serviço com sua duração, para a agenda calcular o horário certo.", status: "disponivel" },
  { id: "horarios", rotulo: "Horários de funcionamento", descricao: "Dias e horários em que o negócio atende.", status: "disponivel" },
  { id: "bloqueios", rotulo: "Bloqueios", descricao: "Folgas, almoço e outros horários indisponíveis na agenda.", status: "disponivel" },
  { id: "clientes", rotulo: "Clientes", descricao: "Cadastro de clientes com histórico de agendamentos.", status: "disponivel" },
  { id: "agendamento-publico", rotulo: "Agendamento público", descricao: "Página própria onde o cliente marca um horário sozinho.", status: "disponivel" },
  { id: "unidades", rotulo: "Unidades", descricao: "Mais de um endereço para negócios com mais de uma unidade.", status: "disponivel" },
  { id: "equipe-permissoes", rotulo: "Equipe e permissões", descricao: "Donos, gerentes, recepcionistas e profissionais, cada um com seu acesso.", status: "disponivel" },
  { id: "personalizacao", rotulo: "Personalização", descricao: "Cores, logo e apresentação da página pública do negócio.", status: "disponivel" },
  { id: "comissoes", rotulo: "Comissões", descricao: "Regras de comissão por profissional ou serviço.", status: "disponivel" },
  { id: "administracao", rotulo: "Administração básica", descricao: "Configurações gerais do negócio num só lugar.", status: "disponivel" },
];

/** Anunciadas como próximo passo do piloto — nunca como já funcionando. Ver
 * docs/plans/mvp-agendamento-pequenos-negocios.md para os requisitos completos. */
export const FUNCIONALIDADES_EM_DESENVOLVIMENTO: Funcionalidade[] = [
  { id: "lembrete", rotulo: "Lembrete antes do atendimento", descricao: "Aviso automático antes do horário marcado.", status: "em-desenvolvimento" },
  { id: "confirmacao", rotulo: "Confirmação pelo cliente", descricao: "Cliente confirma presença a partir do lembrete.", status: "em-desenvolvimento" },
  { id: "cancelamento-link", rotulo: "Cancelamento e remarcação por link", descricao: "Cliente ajusta o próprio horário sem precisar ligar.", status: "em-desenvolvimento" },
  { id: "pos-atendimento", rotulo: "Mensagem pós-atendimento", descricao: "Mensagem automática enviada depois do horário concluído.", status: "em-desenvolvimento" },
  { id: "satisfacao", rotulo: "Pesquisa rápida de satisfação", descricao: "Pergunta curta sobre o atendimento, respondida em segundos.", status: "em-desenvolvimento" },
  { id: "convite-reagendamento", rotulo: "Convite para novo agendamento", descricao: "Sugestão de retorno depois de um tempo sem agendar.", status: "em-desenvolvimento" },
  { id: "notificacoes-estabelecimento", rotulo: "Notificações para o estabelecimento", descricao: "Aviso ao negócio sobre novos agendamentos e alterações.", status: "em-desenvolvimento" },
];

export interface EtapaComoComecar {
  numero: number;
  titulo: string;
  descricao: string;
}

export const COMO_COMECAR: EtapaComoComecar[] = [
  { numero: 1, titulo: "Crie sua demonstração", descricao: "Responda algumas perguntas rápidas sobre seu negócio — sem cartão e sem senha real." },
  { numero: 2, titulo: "Configure em minutos", descricao: "Cadastre profissionais, serviços e horários de funcionamento." },
  { numero: 3, titulo: "Compartilhe seu link", descricao: "Envie a página pública do seu negócio para os clientes agendarem sozinhos." },
];

export interface EtapaFluxo {
  numero: number;
  titulo: string;
  descricao: string;
}

export const FLUXO_DEMONSTRACAO: EtapaFluxo[] = [
  { numero: 1, titulo: "Cliente acessa a página do negócio", descricao: "Um link único, sem aplicativo e sem cadastro prévio." },
  { numero: 2, titulo: "Escolhe serviço, profissional e horário", descricao: "A agenda mostra só os horários realmente disponíveis." },
  { numero: 3, titulo: "Agendamento aparece na agenda do negócio", descricao: "Sem troca de mensagens — o horário já entra organizado." },
  { numero: 4, titulo: "Negócio acompanha tudo no painel", descricao: "Visão do dia, da equipe e do histórico de cada cliente." },
];

export interface PlanoComercial {
  /** Código interno estável do domínio (`essencial`/`equipe`/`pro`,
   * `CodigoPlano` em src/lib/types.ts) — o mesmo usado em `src/lib/planos.ts`
   * e no catálogo persistido no banco. Nome exibido ao cliente vem de `nome`,
   * que é decisão de marketing e pode divergir do código (ex.: `equipe`
   * aparece como "Gestão"). */
  codigo: CodigoPlano;
  nome: string;
  descricaoCurta: string;
  precoTexto: string;
  destaques: string[];
  ctaHref: string;
}

/** Nomes de marketing — mapeiam para os planos reais (essencial/equipe/pro) de
 * `src/lib/planos.ts` usando o mesmo código interno, com rótulos voltados a
 * quem está decidindo assinar. Preço ainda não foi aprovado comercialmente:
 * nunca mostrar valor numérico, só "em definição" ou convite para o piloto. */
export const PLANOS_COMERCIAIS: PlanoComercial[] = [
  {
    codigo: "essencial",
    nome: "Essencial",
    descricaoCurta: "Para quem trabalha sozinho ou com uma equipe pequena.",
    precoTexto: "Preço em definição para o piloto",
    destaques: ["Agenda", "Agendamento público", "Cadastro de profissionais"],
    ctaHref: HREF_TESTAR_GRATIS,
  },
  {
    codigo: "equipe",
    nome: "Gestão",
    descricaoCurta: "Para negócios que já acompanham clientes e relatórios básicos.",
    precoTexto: "Participe do piloto",
    destaques: ["Tudo do Essencial", "Cadastro de clientes", "Relatórios básicos", "Gestão de equipe"],
    ctaHref: HREF_TESTAR_GRATIS,
  },
  {
    codigo: "pro",
    nome: "Rede",
    descricaoCurta: "Para negócios com mais de uma unidade.",
    precoTexto: "Participe do piloto",
    destaques: ["Tudo do Gestão", "Múltiplas unidades", "Personalização avançada"],
    ctaHref: HREF_TESTAR_GRATIS,
  },
];

export interface PerguntaFrequente {
  id: string;
  pergunta: string;
  resposta: string;
}

export const PERGUNTAS_FREQUENTES: PerguntaFrequente[] = [
  {
    id: "precisa-cartao",
    pergunta: "Preciso de cartão de crédito para testar?",
    resposta: "Não. A demonstração usa dados fictícios guardados só no seu navegador — sem cartão e sem senha real.",
  },
  {
    id: "meus-dados",
    pergunta: "Onde ficam os dados que eu cadastrar na demonstração?",
    resposta: "Ficam salvos localmente no seu navegador (localStorage). Eles não são enviados para nenhum servidor nesta etapa.",
  },
  {
    id: "whatsapp-sms",
    pergunta: "O sistema já envia WhatsApp, SMS ou lembrete automático?",
    resposta: "Ainda não. Lembretes, confirmações e mensagens automáticas estão em desenvolvimento para o piloto — veja a seção de funcionalidades.",
  },
  {
    id: "meu-segmento",
    pergunta: "Serve para o meu tipo de negócio?",
    resposta: "Se o seu negócio funciona com horário marcado — salão, clínica, terapia, aula, pet shop e outros — o Agenda Cloud se adapta ao seu segmento.",
  },
  {
    id: "clinica-prontuario",
    pergunta: "Para clínicas e consultórios, existe prontuário ou dados médicos?",
    resposta: "Não nesta etapa. O sistema trata agenda, atendimento e cadastro geral — sem prontuário ou dados de saúde.",
  },
];
