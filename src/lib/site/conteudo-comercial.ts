// Conteúdo textual da página inicial pública. Extraído como dados puros, sem
// JSX, para poder ser testado sem renderizar componentes (ver
// conteudo-comercial.test.ts) e para os componentes de `src/components/site/`
// ficarem só de apresentação.
//
// Regra do conteúdo: só o que o produto PUBLICADO sustenta. Sem preço, número
// de clientes, depoimento, avaliação, integração ou automação; nada que ainda
// não tenha tela funcionando (lembretes, WhatsApp automático, push,
// multiunidade, personalização). Ver docs/plans/pagina-inicial-repaginada.md.

import type { CodigoPlano } from "../types";
import { NOME_PRODUTO } from "../config";

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

/** Login da conta REAL (backend NestJS). */
export const HREF_ENTRAR = "/login";
/** Como obter acesso: não há cadastro aberto. A administração cria o
 * estabelecimento e convida o responsável por e-mail. A seção de contato da
 * própria página explica isso e traz o e-mail público; `/cadastro` só explica
 * o convite, sem contato, e continua ligada ao login. */
export const HREF_COMO_OBTER_ACESSO = "#contato";
/** Demonstração local (onboarding + painel com dados fictícios no navegador).
 * Nunca chamar de "teste grátis" da conta real: são coisas diferentes. */
export const HREF_DEMONSTRACAO = "/onboarding";

/** E-mail público de contato comercial. Aparece na página: é público por
 * definição, não é segredo. */
export const EMAIL_CONTATO = "timvix.agenda@gmail.com";
export const HREF_EMAIL_CONTATO = `mailto:${EMAIL_CONTATO}?subject=${encodeURIComponent(`Acesso ao ${NOME_PRODUTO}`)}`;

export const TOPO = {
  selo: "Agenda online para negócios com horário marcado",
  titulo: "A agenda do seu negócio, organizada num só lugar.",
  texto:
    "Serviços, profissionais, horários e os pedidos de agendamento dos seus clientes numa agenda que a equipe acompanha no computador ou no celular.",
  notaDemonstracao: "dados fictícios, guardados só neste navegador",
} as const;

export interface Segmento {
  id: string;
  rotulo: string;
}

/** Lista deliberadamente ampla: nenhum negócio aparece como o único foco do
 * produto. "outro" fica por último como categoria de saída. */
export const SEGMENTOS: Segmento[] = [
  { id: "salao-barbearia", rotulo: "Salão e barbearia" },
  { id: "estetica", rotulo: "Estética" },
  { id: "clinica", rotulo: "Clínica e consultório" },
  { id: "terapeuta", rotulo: "Terapeuta" },
  { id: "massagem", rotulo: "Massagem" },
  { id: "pilates-yoga", rotulo: "Pilates e yoga" },
  { id: "tatuagem", rotulo: "Tatuagem" },
  { id: "petshop", rotulo: "Pet shop e banho e tosa" },
  { id: "professor-consultor", rotulo: "Professor e consultor" },
  { id: "outro", rotulo: "Outros serviços com horário marcado" },
];

export const PARA_QUEM = {
  titulo: "Para quem trabalha com horário marcado",
  texto:
    "Para negócios pequenos, de quem atende sozinho a equipes de até 20 profissionais. Os termos da tela acompanham o tipo de negócio.",
} as const;

export interface EtapaComoFunciona {
  numero: number;
  titulo: string;
  descricao: string;
}

/** O pedido do cliente nasce PENDENTE: entra na agenda como "Aguardando
 * confirmação" e já ocupa o horário (backend/src/public-booking e
 * availability-rules.ts, item 5). Quem confirma ou recusa é a equipe. */
export const COMO_FUNCIONA: EtapaComoFunciona[] = [
  {
    numero: 1,
    titulo: "Você configura",
    descricao: "Cadastre os serviços com a duração, os profissionais e os horários de trabalho de cada um.",
  },
  {
    numero: 2,
    titulo: "O cliente pede o horário",
    descricao:
      "Pela página de agendamento do seu negócio, ele escolhe serviço, profissional e um horário livre, sem criar conta.",
  },
  {
    numero: 3,
    titulo: "Sua equipe confirma",
    descricao:
      "O pedido entra na agenda como “Aguardando confirmação” e já reserva o horário. Com o sistema aberto, um aviso aparece na tela; vocês confirmam ou recusam.",
  },
];

export interface Funcionalidade {
  id: string;
  rotulo: string;
  descricao: string;
}

/** Os três pontos fortes, em destaque. */
export const FUNCIONALIDADES_DESTAQUE: Funcionalidade[] = [
  {
    id: "agenda",
    rotulo: "Agenda do dia, da semana e do mês",
    descricao: "Lista, visão por profissional e calendário. Cada atendimento com horário, cliente, serviço e situação.",
  },
  {
    id: "agendamento-publico",
    rotulo: "Página de agendamento",
    descricao:
      "Um endereço do seu negócio para o cliente escolher serviço, profissional e horário. Só aparecem horários livres.",
  },
  {
    id: "equipe-permissoes",
    rotulo: "Equipe com acessos separados",
    descricao: "O gerente faz só o que o dono liberar. O profissional entra com o próprio acesso e vê a própria agenda.",
  },
];

/** Só o que existe de fato e já está publicado. Nunca liste aqui algo que
 * ainda não tem tela funcionando. Comissões existem nos planos Pro e Max. */
export const FUNCIONALIDADES_DISPONIVEIS: Funcionalidade[] = [
  { id: "servicos", rotulo: "Serviços e duração", descricao: "A duração de cada serviço define o horário que ele ocupa na agenda." },
  { id: "horarios", rotulo: "Horários e bloqueios", descricao: "Jornada semanal de cada profissional, folgas e intervalos." },
  { id: "clientes", rotulo: "Clientes", descricao: "Cadastro com o histórico de agendamentos de cada cliente." },
  {
    id: "recebimentos",
    rotulo: "Recebimentos",
    descricao: "Registro manual do que foi recebido, com estorno. O sistema não faz cobrança.",
  },
  {
    id: "comissoes",
    rotulo: "Comissões",
    descricao: "Regra por profissional e serviço, apurada quando o atendimento é concluído. Nos planos Pro e Max.",
  },
];

export interface PlanoComercial {
  /** Código interno estável do domínio (`essencial`/`equipe`/`pro`,
   * `CodigoPlano` em src/lib/types.ts), o mesmo do catálogo persistido no
   * banco (backend/src/commercial/plan-catalog.ts). O nome exibido diverge do
   * código: `essencial` é o Básico, `equipe` é o Pro e `pro` é o Max. */
  codigo: CodigoPlano;
  nome: string;
  descricaoCurta: string;
  destaques: string[];
}

/** Sem preço: o catálogo não tem valor (`price_cents` nulo) e o preço é
 * combinado na liberação do acesso. Multiunidade não existe no produto:
 * nenhum plano a promete. */
export const PLANOS_COMERCIAIS: PlanoComercial[] = [
  {
    codigo: "essencial",
    nome: "Básico",
    descricaoCurta: "Para quem atende sozinho ou com uma equipe pequena.",
    destaques: ["Agenda e página de agendamento", "Clientes, equipe e recebimentos", "Até 2 profissionais"],
  },
  {
    codigo: "equipe",
    nome: "Pro",
    descricaoCurta: "Para equipes que estão crescendo.",
    destaques: ["Tudo do Básico", "Até 5 profissionais", "Comissões por profissional e serviço"],
  },
  {
    codigo: "pro",
    nome: "Max",
    descricaoCurta: "Para equipes maiores.",
    destaques: ["Tudo do Pro", "Até 20 profissionais"],
  },
];

export const NOTA_DOS_PLANOS =
  "Sem preço publicado: o valor é combinado com a administração na liberação do acesso.";

export const CONTATO = {
  titulo: "Como obter acesso",
  texto: `Não há cadastro aberto. A administração do ${NOME_PRODUTO} cria o estabelecimento e envia um convite para o e-mail do responsável; pelo link do convite você cria a sua senha.`,
  pedido: "Escreva contando o nome do negócio, o tipo de atendimento e quantos profissionais atendem.",
} as const;

export interface PerguntaFrequente {
  id: string;
  pergunta: string;
  resposta: string;
}

export const PERGUNTAS_FREQUENTES: PerguntaFrequente[] = [
  {
    id: "como-obter-acesso",
    pergunta: "Como consigo acesso?",
    resposta: `A administração cria o estabelecimento e envia um convite ao e-mail do responsável. Fale com a gente em ${EMAIL_CONTATO}.`,
  },
  {
    id: "cliente-precisa-conta",
    pergunta: "Meu cliente precisa criar conta para agendar?",
    resposta: "Não. Ele abre a página de agendamento do seu negócio, escolhe o horário e informa nome e telefone.",
  },
  {
    id: "whatsapp-sms",
    pergunta: "O sistema envia WhatsApp, SMS ou lembrete automático?",
    resposta: "Ainda não. Hoje nenhuma mensagem é enviada sozinha para os seus clientes.",
  },
  {
    id: "demonstracao",
    pergunta: "O que é a demonstração?",
    resposta:
      "Uma simulação com dados fictícios, guardados só no seu navegador. Ela é separada da conta real e nada do que você fizer nela é enviado.",
  },
  {
    id: "meu-segmento",
    pergunta: "Serve para o meu tipo de negócio?",
    resposta: `Se o seu negócio funciona com horário marcado (salão, clínica, terapia, aula, pet shop e outros), o ${NOME_PRODUTO} organiza a agenda e os pedidos.`,
  },
  {
    id: "clinica-prontuario",
    pergunta: "Para clínicas e consultórios, existe prontuário ou dados médicos?",
    resposta: "Não. O sistema trata agenda, atendimento e cadastro geral, sem prontuário ou dados de saúde.",
  },
];
