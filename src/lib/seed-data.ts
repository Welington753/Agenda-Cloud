// Dados simulados. Cada estabelecimento é só configuração (categoria, identidade
// visual, plano/features, políticas) + dados sobre as mesmas entidades genéricas —
// nada aqui exige tratamento especial no motor de disponibilidade ou nos
// repositórios. Dom Navalha, Clínica Sorriso Leve, Barbearia JR e Barbeiro Bastião
// têm dados operacionais completos (provam que a mesma UI atende negócios de
// tamanhos/nichos diferentes); Corte Certo e Barbearia Vintage existem só para o
// painel master ter mais estabelecimentos na listagem (o segundo também demonstra
// um tenant suspenso).

import { addDays, getDay, setHours, setMinutes, startOfDay } from "date-fns";
import { obterDefinicaoPlano } from "./planos";
import type {
  Agendamento,
  Bloqueio,
  Consumidor,
  Convite,
  DiaSemana,
  Estabelecimento,
  Feature,
  HistoricoAlteracao,
  Membership,
  Profissional,
  Recurso,
  RegistroAuditoria,
  RegrasAgendamento,
  Servico,
  StatusAgendamento,
  Unidade,
  UsuarioEstabelecimento,
  UsuarioPlataforma,
} from "./types";

const TENANT_DOM_NAVALHA = "tenant-dom-navalha";
const TENANT_CORTE_CERTO = "tenant-corte-certo";
const TENANT_BARBEARIA_VINTAGE = "tenant-barbearia-vintage";
const TENANT_CLINICA_SORRISO_LEVE = "tenant-clinica-sorriso-leve";
const TENANT_BARBEARIA_JR = "tenant-barbearia-jr";
const TENANT_BARBEIRO_BASTIAO = "tenant-barbeiro-bastiao";

const DIAS_TER_A_SAB: DiaSemana[] = [2, 3, 4, 5, 6];
const DIAS_SEG_A_SEX: DiaSemana[] = [1, 2, 3, 4, 5];
const DIAS_SEG_A_SAB: DiaSemana[] = [1, 2, 3, 4, 5, 6];

function horaISO(dia: Date, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return setMinutes(setHours(startOfDay(dia), h), m).toISOString();
}

function somarMinutosISO(iso: string, minutos: number): string {
  return new Date(new Date(iso).getTime() + minutos * 60_000).toISOString();
}

/** Encontra os próximos `quantidade` dias (a partir de `offset` dias de hoje) em que o
 * estabelecimento funciona, andando para frente no calendário. */
function proximosDiasUteis(offsetInicial: number, quantidade: number, diasFuncionamento: DiaSemana[]): Date[] {
  const dias: Date[] = [];
  let cursor = offsetInicial;
  while (dias.length < quantidade && cursor < offsetInicial + 60) {
    const candidato = addDays(startOfDay(new Date()), cursor);
    if (diasFuncionamento.includes(getDay(candidato) as DiaSemana)) {
      dias.push(candidato);
    }
    cursor += 1;
  }
  return dias;
}

/** Anda para trás no calendário buscando dias em que o estabelecimento funcionou. */
function diasUteisPassados(quantidade: number, diasFuncionamento: DiaSemana[]): Date[] {
  const dias: Date[] = [];
  let cursor = -1;
  while (dias.length < quantidade && cursor > -60) {
    const candidato = addDays(startOfDay(new Date()), cursor);
    if (diasFuncionamento.includes(getDay(candidato) as DiaSemana)) {
      dias.push(candidato);
    }
    cursor -= 1;
  }
  return dias.reverse();
}

function historico(status: StatusAgendamento, por: string, criadoEm: string): HistoricoAlteracao[] {
  return [{ em: criadoEm, de: "criado", para: status, por }];
}

function regrasPadrao(overrides: Partial<RegrasAgendamento> = {}): RegrasAgendamento {
  return {
    antecedenciaMinimaMinutos: 60,
    limiteDiasFuturos: 30,
    prazoCancelamentoHoras: 3,
    confirmacaoAutomatica: false,
    permitirQualquerProfissional: true,
    permitirRemarcacaoCliente: true,
    exigirTelefoneCliente: true,
    exigirEmailCliente: false,
    exibirPrecoPublico: true,
    intervaloPadraoMinutos: 0,
    ...overrides,
  };
}

export function gerarEstabelecimentosSeed(): Estabelecimento[] {
  return [
    {
      id: "estab-dom-navalha",
      tenantId: TENANT_DOM_NAVALHA,
      slug: "dom-navalha",
      categoria: "barbearia",
      identidadeVisual: {
        nome: "Barbearia Dom Navalha",
        nomeCurto: "Dom Navalha",
        logoIniciais: "DN",
        corPrincipal: "#1C1A17",
        corSecundaria: "#FAF7F2",
        corDestaque: "#B5651D",
        estilo: "Sofisticado, grafite e cobre",
        modelo: "classico",
        endereco: "Rua das Palmeiras, 245 – Centro",
        telefone: "(11) 99999-9999",
        redesSociais: { instagram: "@domnavalha" },
        textoApresentacao: "Barbearia de bairro com acabamento de navalha e atendimento sem enrolação.",
        fotos: [],
      },
      documentoFiscal: "12.345.678/0001-01",
      fusoHorario: "America/Sao_Paulo",
      horarioGeral: { diasFuncionamento: DIAS_TER_A_SAB, abertura: "09:00", fechamento: "19:00" },
      regras: regrasPadrao({ antecedenciaMinimaMinutos: 60, limiteDiasFuturos: 30, prazoCancelamentoHoras: 3 }),
      plano: "pro",
      featuresDesativadas: [],
      limites: obterDefinicaoPlano("pro").limites,
      status: "ativo",
      criadoEm: addDays(new Date(), -220).toISOString(),
      quantidadeProfissionais: 3,
    },
    {
      id: "estab-corte-certo",
      tenantId: TENANT_CORTE_CERTO,
      slug: "corte-certo",
      categoria: "barbearia",
      identidadeVisual: {
        nome: "Corte Certo Barbearia",
        nomeCurto: "Corte Certo",
        logoIniciais: "CC",
        corPrincipal: "#1C1A17",
        corSecundaria: "#FAF7F2",
        corDestaque: "#2F6F4E",
        estilo: "Moderno",
        modelo: "moderno",
        endereco: "Av. Brasil, 900 – Jardim América",
        telefone: "(11) 98888-1234",
        textoApresentacao: "Barbearia em fase de testes na plataforma.",
        fotos: [],
      },
      documentoFiscal: "23.456.789/0001-02",
      fusoHorario: "America/Sao_Paulo",
      horarioGeral: { diasFuncionamento: DIAS_SEG_A_SAB, abertura: "08:00", fechamento: "20:00" },
      regras: regrasPadrao({ antecedenciaMinimaMinutos: 30, limiteDiasFuturos: 15, prazoCancelamentoHoras: 2 }),
      plano: "essencial",
      featuresDesativadas: [],
      limites: obterDefinicaoPlano("essencial").limites,
      status: "teste",
      criadoEm: addDays(new Date(), -12).toISOString(),
      quantidadeProfissionais: 2,
    },
    {
      id: "estab-barbearia-vintage",
      tenantId: TENANT_BARBEARIA_VINTAGE,
      slug: "barbearia-vintage",
      categoria: "barbearia",
      identidadeVisual: {
        nome: "Barbearia Vintage",
        nomeCurto: "Vintage",
        logoIniciais: "BV",
        corPrincipal: "#1C1A17",
        corSecundaria: "#FAF7F2",
        corDestaque: "#8A8D91",
        estilo: "Retrô",
        modelo: "classico",
        endereco: "Rua Sete de Setembro, 88 – Centro",
        telefone: "(11) 97777-5678",
        textoApresentacao: "Estabelecimento suspenso na plataforma (demonstração).",
        fotos: [],
      },
      documentoFiscal: "34.567.890/0001-03",
      fusoHorario: "America/Sao_Paulo",
      horarioGeral: { diasFuncionamento: DIAS_TER_A_SAB, abertura: "10:00", fechamento: "20:00" },
      regras: regrasPadrao({ antecedenciaMinimaMinutos: 60, limiteDiasFuturos: 20, prazoCancelamentoHoras: 4 }),
      plano: "essencial",
      featuresDesativadas: [],
      limites: obterDefinicaoPlano("essencial").limites,
      status: "suspenso",
      motivoSuspensao: "Pagamento em atraso há mais de 30 dias.",
      criadoEm: addDays(new Date(), -400).toISOString(),
      quantidadeProfissionais: 4,
    },
    {
      id: "estab-clinica-sorriso-leve",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      slug: "clinica-sorriso-leve",
      categoria: "clinica_odontologica",
      identidadeVisual: {
        nome: "Clínica Sorriso Leve",
        nomeCurto: "Sorriso Leve",
        logoIniciais: "SL",
        corPrincipal: "#0F3B4D",
        corSecundaria: "#8FBFA6",
        corDestaque: "#1C6E8C",
        estilo: "Clínico, limpo e acolhedor",
        modelo: "classico",
        endereco: "Av. Higienópolis, 512 – Sala 12",
        telefone: "(11) 3555-2200",
        redesSociais: { instagram: "@sorrisoleveclinica" },
        textoApresentacao: "Cuidado odontológico completo, com atendimento humano e consultas sem espera.",
        fotos: [],
      },
      documentoFiscal: "45.678.901/0001-04",
      fusoHorario: "America/Sao_Paulo",
      horarioGeral: { diasFuncionamento: DIAS_SEG_A_SEX, abertura: "08:00", fechamento: "18:00" },
      regras: regrasPadrao({
        antecedenciaMinimaMinutos: 120,
        limiteDiasFuturos: 45,
        prazoCancelamentoHoras: 24,
        permitirQualquerProfissional: false,
        exigirEmailCliente: true,
        intervaloPadraoMinutos: 10,
      }),
      plano: "equipe",
      featuresDesativadas: [],
      limites: obterDefinicaoPlano("equipe").limites,
      status: "ativo",
      criadoEm: addDays(new Date(), -60).toISOString(),
      quantidadeProfissionais: 2,
    },
    {
      id: "estab-barbearia-jr",
      tenantId: TENANT_BARBEARIA_JR,
      slug: "barbearia-jr",
      categoria: "barbearia",
      identidadeVisual: {
        nome: "Barbearia JR",
        nomeCurto: "JR",
        logoIniciais: "JR",
        corPrincipal: "#141414",
        corSecundaria: "#F5F1E8",
        corDestaque: "#D4A017",
        estilo: "Urbano e despojado",
        modelo: "moderno",
        endereco: "Rua Voluntários da Pátria, 1300 – Santana",
        telefone: "(11) 96222-8080",
        redesSociais: { instagram: "@barbeariajr" },
        textoApresentacao: "Barbearia urbana com playlist boa e horário que cabe na sua rotina.",
        fotos: [],
      },
      documentoFiscal: "56.789.012/0001-05",
      fusoHorario: "America/Sao_Paulo",
      horarioGeral: { diasFuncionamento: DIAS_SEG_A_SAB, abertura: "10:00", fechamento: "21:00" },
      regras: regrasPadrao({ antecedenciaMinimaMinutos: 30, limiteDiasFuturos: 30, prazoCancelamentoHoras: 2 }),
      plano: "equipe",
      // Exceção do master: mesmo o plano Equipe incluindo relatórios, este tenant
      // específico está com o módulo desativado (demonstra a regra 2 do cálculo
      // de acesso — exceção do master vence o que o plano incluiria).
      featuresDesativadas: ["relatorios"],
      limites: obterDefinicaoPlano("equipe").limites,
      status: "ativo",
      criadoEm: addDays(new Date(), -45).toISOString(),
      quantidadeProfissionais: 2,
    },
    {
      id: "estab-barbeiro-bastiao",
      tenantId: TENANT_BARBEIRO_BASTIAO,
      slug: "barbeiro-bastiao",
      categoria: "barbearia",
      identidadeVisual: {
        nome: "Barbeiro Bastião",
        nomeCurto: "Bastião",
        logoIniciais: "BB",
        corPrincipal: "#2B2321",
        corSecundaria: "#EFE6DA",
        corDestaque: "#6B4226",
        estilo: "Artesanal, um profissional só",
        modelo: "classico",
        endereco: "Rua dos Ipês, 45 – Vila Ipê",
        telefone: "(11) 95111-4433",
        textoApresentacao: "Corte e barba feitos com calma, na cadeira do próprio Bastião.",
        fotos: [],
      },
      documentoFiscal: undefined,
      fusoHorario: "America/Sao_Paulo",
      horarioGeral: { diasFuncionamento: DIAS_TER_A_SAB, abertura: "09:00", fechamento: "18:00" },
      regras: regrasPadrao({ antecedenciaMinimaMinutos: 60, limiteDiasFuturos: 20, prazoCancelamentoHoras: 3 }),
      plano: "essencial",
      featuresDesativadas: [],
      // Override do master: plano Essencial permite até 2 profissionais, mas este
      // tenant é um barbeiro autônomo — limite ajustado para 1.
      limites: { ...obterDefinicaoPlano("essencial").limites, maxProfissionais: 1 },
      status: "ativo",
      criadoEm: addDays(new Date(), -90).toISOString(),
      quantidadeProfissionais: 1,
    },
  ];
}

export function gerarUnidadesSeed(): Unidade[] {
  return [
    { id: "unidade-dom-navalha", tenantId: TENANT_DOM_NAVALHA, nome: "Unidade Centro", endereco: "Rua das Palmeiras, 245 – Centro", principal: true },
    { id: "unidade-clinica-sorriso-leve", tenantId: TENANT_CLINICA_SORRISO_LEVE, nome: "Unidade Higienópolis", endereco: "Av. Higienópolis, 512 – Sala 12", principal: true },
    { id: "unidade-barbearia-jr", tenantId: TENANT_BARBEARIA_JR, nome: "Unidade Santana", endereco: "Rua Voluntários da Pátria, 1300 – Santana", principal: true },
    { id: "unidade-barbeiro-bastiao", tenantId: TENANT_BARBEIRO_BASTIAO, nome: "Unidade Vila Ipê", endereco: "Rua dos Ipês, 45 – Vila Ipê", principal: true },
  ];
}

/** Modelado para evolução futura (ver docs/plans/refatoracao-multinicho.md): existe
 * apenas como dado simulado, sem tela própria e sem entrar no motor de
 * disponibilidade — bloqueio simultâneo de recursos ainda não é verificado. */
export function gerarRecursosSeed(): Recurso[] {
  return [
    { id: "recurso-cadeira-1", tenantId: TENANT_DOM_NAVALHA, nome: "Cadeira 1", tipo: "cadeira", ativo: true },
    { id: "recurso-cadeira-2", tenantId: TENANT_DOM_NAVALHA, nome: "Cadeira 2", tipo: "cadeira", ativo: true },
    { id: "recurso-cadeira-3", tenantId: TENANT_DOM_NAVALHA, nome: "Cadeira 3", tipo: "cadeira", ativo: true },
    { id: "recurso-consultorio-1", tenantId: TENANT_CLINICA_SORRISO_LEVE, nome: "Consultório 1", tipo: "consultorio", ativo: true },
    { id: "recurso-consultorio-2", tenantId: TENANT_CLINICA_SORRISO_LEVE, nome: "Consultório 2", tipo: "consultorio", ativo: true },
  ];
}

function horarioSemanal(
  dias: DiaSemana[],
  base: { inicio: string; fim: string; almocoInicio?: string; almocoFim?: string },
  extra?: Partial<Record<number, Partial<{ inicio: string; fim: string }>>>
) {
  return dias.map((dia) => ({
    diaSemana: dia,
    ativo: true,
    inicio: extra?.[dia]?.inicio ?? base.inicio,
    fim: extra?.[dia]?.fim ?? base.fim,
    almocoInicio: base.almocoInicio,
    almocoFim: base.almocoFim,
  }));
}

export function gerarProfissionaisSeed(): Profissional[] {
  return [
    {
      id: "prof-joao-silva",
      tenantId: TENANT_DOM_NAVALHA,
      unidadeId: "unidade-dom-navalha",
      nome: "João Silva",
      avatarIniciais: "JS",
      corAvatar: "#B5651D",
      servicosIds: ["serv-corte-tradicional", "serv-corte-degrade", "serv-barba", "serv-corte-barba", "serv-corte-infantil"],
      horarios: horarioSemanal(DIAS_TER_A_SAB, { inicio: "09:00", fim: "19:00", almocoInicio: "12:00", almocoFim: "13:00" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-pedro-martins",
      tenantId: TENANT_DOM_NAVALHA,
      unidadeId: "unidade-dom-navalha",
      nome: "Pedro Martins",
      avatarIniciais: "PM",
      corAvatar: "#3B5A6B",
      servicosIds: ["serv-corte-tradicional", "serv-corte-degrade", "serv-barba", "serv-corte-barba"],
      horarios: horarioSemanal(
        DIAS_TER_A_SAB,
        { inicio: "09:00", fim: "19:00", almocoInicio: "12:00", almocoFim: "13:00" },
        { 6: { fim: "14:00" } }
      ),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-rafael-costa",
      tenantId: TENANT_DOM_NAVALHA,
      unidadeId: "unidade-dom-navalha",
      nome: "Rafael Costa",
      avatarIniciais: "RC",
      corAvatar: "#6B4226",
      servicosIds: ["serv-corte-degrade", "serv-barba", "serv-corte-barba"],
      horarios: horarioSemanal([3, 4, 5, 6], { inicio: "10:00", fim: "19:00", almocoInicio: "13:00", almocoFim: "14:00" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-mariana-alves",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      unidadeId: "unidade-clinica-sorriso-leve",
      nome: "Dra. Mariana Alves",
      avatarIniciais: "MA",
      corAvatar: "#1C6E8C",
      servicosIds: ["serv-avaliacao-inicial", "serv-limpeza", "serv-clareamento"],
      horarios: horarioSemanal(DIAS_SEG_A_SEX, { inicio: "08:00", fim: "18:00", almocoInicio: "12:00", almocoFim: "13:00" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-lucas-ferreira",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      unidadeId: "unidade-clinica-sorriso-leve",
      nome: "Dr. Lucas Ferreira",
      avatarIniciais: "LF",
      corAvatar: "#3E7C59",
      servicosIds: ["serv-avaliacao-inicial", "serv-limpeza"],
      horarios: horarioSemanal([2, 3, 4, 5], { inicio: "08:30", fim: "17:30", almocoInicio: "12:30", almocoFim: "13:30" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-jonas-ribeiro",
      tenantId: TENANT_BARBEARIA_JR,
      unidadeId: "unidade-barbearia-jr",
      nome: "Jonas Ribeiro",
      avatarIniciais: "JR",
      corAvatar: "#D4A017",
      servicosIds: ["serv-jr-corte", "serv-jr-barba", "serv-jr-combo"],
      horarios: horarioSemanal(DIAS_SEG_A_SAB, { inicio: "10:00", fim: "21:00", almocoInicio: "13:00", almocoFim: "14:00" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-kayky-souza",
      tenantId: TENANT_BARBEARIA_JR,
      unidadeId: "unidade-barbearia-jr",
      nome: "Kayky Souza",
      avatarIniciais: "KS",
      corAvatar: "#8A6D3B",
      servicosIds: ["serv-jr-corte", "serv-jr-combo"],
      horarios: horarioSemanal(
        DIAS_SEG_A_SAB,
        { inicio: "12:00", fim: "21:00", almocoInicio: "16:00", almocoFim: "16:30" },
        { 6: { inicio: "10:00", fim: "18:00" } }
      ),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-bastiao-nunes",
      tenantId: TENANT_BARBEIRO_BASTIAO,
      unidadeId: "unidade-barbeiro-bastiao",
      nome: "Bastião Nunes",
      avatarIniciais: "BN",
      corAvatar: "#6B4226",
      servicosIds: ["serv-bast-corte", "serv-bast-barba"],
      horarios: horarioSemanal(DIAS_TER_A_SAB, { inicio: "09:00", fim: "18:00", almocoInicio: "12:00", almocoFim: "13:30" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
  ];
}

export function gerarServicosSeed(): Servico[] {
  return [
    {
      id: "serv-corte-tradicional",
      tenantId: TENANT_DOM_NAVALHA,
      nome: "Corte tradicional",
      descricaoCurta: "Corte na tesoura e máquina, acabamento na navalha.",
      precoCentavos: 4000,
      precoVisivel: true,
      duracaoMinutos: 30,
      intervaloPosteriorMinutos: 0,
      modalidade: "presencial",
      profissionaisIds: ["prof-joao-silva", "prof-pedro-martins"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
    {
      id: "serv-corte-degrade",
      tenantId: TENANT_DOM_NAVALHA,
      nome: "Corte degradê",
      descricaoCurta: "Degradê navalhado com acabamento personalizado.",
      precoCentavos: 5000,
      precoVisivel: true,
      duracaoMinutos: 45,
      intervaloPosteriorMinutos: 5,
      modalidade: "presencial",
      profissionaisIds: ["prof-joao-silva", "prof-pedro-martins", "prof-rafael-costa"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
    {
      id: "serv-barba",
      tenantId: TENANT_DOM_NAVALHA,
      nome: "Barba",
      descricaoCurta: "Toalha quente, navalha e hidratação.",
      precoCentavos: 3000,
      precoVisivel: true,
      duracaoMinutos: 30,
      intervaloPosteriorMinutos: 0,
      modalidade: "presencial",
      profissionaisIds: ["prof-joao-silva", "prof-pedro-martins", "prof-rafael-costa"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
    {
      id: "serv-corte-barba",
      tenantId: TENANT_DOM_NAVALHA,
      nome: "Corte + barba",
      descricaoCurta: "Combo completo com acabamento na navalha.",
      precoCentavos: 7000,
      precoVisivel: true,
      duracaoMinutos: 60,
      intervaloPosteriorMinutos: 10,
      modalidade: "presencial",
      profissionaisIds: ["prof-joao-silva", "prof-pedro-martins", "prof-rafael-costa"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
    {
      id: "serv-corte-infantil",
      tenantId: TENANT_DOM_NAVALHA,
      nome: "Corte infantil",
      descricaoCurta: "Corte para crianças até 10 anos, com paciência extra.",
      precoCentavos: 3500,
      precoVisivel: true,
      duracaoMinutos: 30,
      intervaloPosteriorMinutos: 0,
      modalidade: "presencial",
      profissionaisIds: ["prof-joao-silva"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
    {
      id: "serv-avaliacao-inicial",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      nome: "Avaliação inicial",
      descricaoCurta: "Exame clínico completo para planejar o tratamento.",
      precoCentavos: 5000,
      precoVisivel: false,
      duracaoMinutos: 40,
      intervaloPosteriorMinutos: 10,
      modalidade: "presencial",
      profissionaisIds: ["prof-mariana-alves", "prof-lucas-ferreira"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: true,
      ativo: true,
    },
    {
      id: "serv-limpeza",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      nome: "Limpeza",
      descricaoCurta: "Profilaxia e remoção de tártaro.",
      precoCentavos: 18000,
      precoVisivel: true,
      duracaoMinutos: 60,
      intervaloPosteriorMinutos: 10,
      modalidade: "presencial",
      profissionaisIds: ["prof-mariana-alves", "prof-lucas-ferreira"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
    {
      id: "serv-clareamento",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      nome: "Clareamento",
      descricaoCurta: "Clareamento dental a laser em consultório.",
      precoVisivel: true,
      duracaoMinutos: 90,
      intervaloPosteriorMinutos: 15,
      modalidade: "presencial",
      profissionaisIds: ["prof-mariana-alves"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: true,
      ativo: true,
    },
    {
      id: "serv-jr-corte",
      tenantId: TENANT_BARBEARIA_JR,
      nome: "Corte na máquina",
      descricaoCurta: "Corte moderno na máquina com acabamento na régua.",
      precoCentavos: 4500,
      precoVisivel: true,
      duracaoMinutos: 30,
      intervaloPosteriorMinutos: 0,
      modalidade: "presencial",
      profissionaisIds: ["prof-jonas-ribeiro", "prof-kayky-souza"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
    {
      id: "serv-jr-barba",
      tenantId: TENANT_BARBEARIA_JR,
      nome: "Barba desenhada",
      descricaoCurta: "Barba alinhada e desenhada na navalha.",
      precoCentavos: 3500,
      precoVisivel: true,
      duracaoMinutos: 25,
      intervaloPosteriorMinutos: 0,
      modalidade: "presencial",
      profissionaisIds: ["prof-jonas-ribeiro"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
    {
      id: "serv-jr-combo",
      tenantId: TENANT_BARBEARIA_JR,
      nome: "Combo completo",
      descricaoCurta: "Corte + barba com sobrancelha incluída.",
      precoCentavos: 7500,
      precoVisivel: true,
      duracaoMinutos: 60,
      intervaloPosteriorMinutos: 10,
      modalidade: "presencial",
      profissionaisIds: ["prof-jonas-ribeiro", "prof-kayky-souza"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
    {
      id: "serv-bast-corte",
      tenantId: TENANT_BARBEIRO_BASTIAO,
      nome: "Corte simples",
      descricaoCurta: "Corte clássico na tesoura, com calma.",
      precoCentavos: 3500,
      precoVisivel: true,
      duracaoMinutos: 40,
      intervaloPosteriorMinutos: 5,
      modalidade: "presencial",
      profissionaisIds: ["prof-bastiao-nunes"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
    {
      id: "serv-bast-barba",
      tenantId: TENANT_BARBEIRO_BASTIAO,
      nome: "Barba",
      descricaoCurta: "Barba feita na navalha, com toalha quente.",
      precoCentavos: 2500,
      precoVisivel: true,
      duracaoMinutos: 30,
      intervaloPosteriorMinutos: 5,
      modalidade: "presencial",
      profissionaisIds: ["prof-bastiao-nunes"],
      ativoNoAgendamentoPublico: true,
      exigeConfirmacaoManual: false,
      ativo: true,
    },
  ];
}

interface RascunhoAgendamento {
  id: string;
  consumidorNome: string;
  consumidorWhatsapp: string;
  profissionalId: string;
  servicoId: string;
  dia: Date | undefined;
  hora: string;
  status: StatusAgendamento;
}

/** Constrói agendamentos e agrega estatísticas de consumidores a partir de
 * rascunhos — reaproveitado por qualquer tenant, sem nenhum conhecimento de
 * nicho. O mesmo telefone pode aparecer em rascunhos de tenants diferentes: como
 * o id do consumidor é derivado de `tenantId + nome`, cada tenant sempre gera um
 * registro `Consumidor` isolado, mesmo que a pessoa "exista" em mais de um. */
function construirAgendamentosEConsumidores(
  tenantId: string,
  rascunhosBrutos: RascunhoAgendamento[],
  duracaoPorServico: Map<string, number>,
  precoPorServico: Map<string, number | undefined>
): { agendamentos: Agendamento[]; consumidores: Consumidor[] } {
  const rascunhos = rascunhosBrutos.filter((r): r is RascunhoAgendamento & { dia: Date } => r.dia !== undefined);

  const agendamentos: Agendamento[] = rascunhos.map((r) => {
    const inicio = horaISO(r.dia, r.hora);
    const duracao = duracaoPorServico.get(r.servicoId) ?? 30;
    const criadoEm = addDays(new Date(inicio), -3).toISOString();
    return {
      id: r.id,
      tenantId,
      consumidorId: `cons-${tenantId}-${slugifyNome(r.consumidorNome)}`,
      consumidorNome: r.consumidorNome,
      consumidorWhatsapp: r.consumidorWhatsapp,
      profissionalId: r.profissionalId,
      servicoId: r.servicoId,
      dataHoraInicio: inicio,
      dataHoraFim: somarMinutosISO(inicio, duracao),
      status: r.status,
      precoCentavos: precoPorServico.get(r.servicoId),
      criadoEm,
      historico: historico(r.status, "consumidor", criadoEm),
    };
  });

  const consumidoresMap = new Map<string, Consumidor>();
  for (const ag of agendamentos) {
    const existente = consumidoresMap.get(ag.consumidorId);
    const isPassadoOuHoje = new Date(ag.dataHoraInicio).getTime() <= Date.now();
    const consumidor: Consumidor = existente ?? {
      id: ag.consumidorId,
      tenantId,
      nome: ag.consumidorNome,
      whatsapp: ag.consumidorWhatsapp,
      totalVisitas: 0,
      totalFaltas: 0,
    };
    if (ag.status === "concluido") {
      consumidor.totalVisitas += 1;
      if (!consumidor.ultimoAtendimentoEm || ag.dataHoraInicio > consumidor.ultimoAtendimentoEm) {
        consumidor.ultimoAtendimentoEm = ag.dataHoraInicio;
      }
    }
    if (ag.status === "nao_compareceu") consumidor.totalFaltas += 1;
    if (!isPassadoOuHoje && (ag.status === "confirmado" || ag.status === "pendente")) {
      if (!consumidor.proximoAgendamentoEm || ag.dataHoraInicio < consumidor.proximoAgendamentoEm) {
        consumidor.proximoAgendamentoEm = ag.dataHoraInicio;
      }
    }
    consumidoresMap.set(ag.consumidorId, consumidor);
  }

  return { agendamentos, consumidores: Array.from(consumidoresMap.values()) };
}

function gerarAgendamentosEConsumidoresDomNavalha(servicos: Servico[]) {
  const doTenant = servicos.filter((s) => s.tenantId === TENANT_DOM_NAVALHA);
  const duracaoPorServico = new Map(doTenant.map((s) => [s.id, s.duracaoMinutos]));
  const precoPorServico = new Map(doTenant.map((s) => [s.id, s.precoCentavos]));

  const [passado2, passado1] = diasUteisPassados(2, DIAS_TER_A_SAB);
  const [hoje, futuro1, futuro2, futuro3, futuro4] = proximosDiasUteis(0, 5, DIAS_TER_A_SAB);

  const rascunhos: RascunhoAgendamento[] = [
    { id: "ag-001", consumidorNome: "Marcos Andrade", consumidorWhatsapp: "(11) 98123-4501", profissionalId: "prof-joao-silva", servicoId: "serv-corte-tradicional", dia: passado2, hora: "10:00", status: "concluido" },
    { id: "ag-002", consumidorNome: "Felipe Nogueira", consumidorWhatsapp: "(11) 98123-4502", profissionalId: "prof-pedro-martins", servicoId: "serv-barba", dia: passado2, hora: "15:00", status: "nao_compareceu" },
    { id: "ag-003", consumidorNome: "Rodrigo Lima", consumidorWhatsapp: "(11) 98123-4503", profissionalId: "prof-rafael-costa", servicoId: "serv-corte-degrade", dia: passado2, hora: "11:00", status: "concluido" },
    { id: "ag-004", consumidorNome: "Marcos Andrade", consumidorWhatsapp: "(11) 98123-4501", profissionalId: "prof-joao-silva", servicoId: "serv-corte-barba", dia: passado1, hora: "09:30", status: "concluido" },
    { id: "ag-005", consumidorNome: "Bruno Carvalho", consumidorWhatsapp: "(11) 98123-4504", profissionalId: "prof-pedro-martins", servicoId: "serv-corte-tradicional", dia: passado1, hora: "17:00", status: "cancelado" },
    { id: "ag-006", consumidorNome: "Diego Fonseca", consumidorWhatsapp: "(11) 98123-4505", profissionalId: "prof-joao-silva", servicoId: "serv-corte-degrade", dia: hoje, hora: "09:30", status: "concluido" },
    { id: "ag-007", consumidorNome: "Rodrigo Lima", consumidorWhatsapp: "(11) 98123-4503", profissionalId: "prof-rafael-costa", servicoId: "serv-barba", dia: hoje, hora: "11:00", status: "confirmado" },
    { id: "ag-008", consumidorNome: "Felipe Nogueira", consumidorWhatsapp: "(11) 98123-4502", profissionalId: "prof-pedro-martins", servicoId: "serv-corte-tradicional", dia: hoje, hora: "14:00", status: "pendente" },
    { id: "ag-009", consumidorNome: "Bruno Carvalho", consumidorWhatsapp: "(11) 98123-4504", profissionalId: "prof-joao-silva", servicoId: "serv-corte-barba", dia: hoje, hora: "16:30", status: "confirmado" },
    { id: "ag-010", consumidorNome: "Marcos Andrade", consumidorWhatsapp: "(11) 98123-4501", profissionalId: "prof-joao-silva", servicoId: "serv-corte-tradicional", dia: futuro1, hora: "10:00", status: "confirmado" },
    { id: "ag-011", consumidorNome: "Diego Fonseca", consumidorWhatsapp: "(11) 98123-4505", profissionalId: "prof-rafael-costa", servicoId: "serv-corte-degrade", dia: futuro1, hora: "11:00", status: "pendente" },
    { id: "ag-012", consumidorNome: "Camila Ribeiro", consumidorWhatsapp: "(11) 98123-4506", profissionalId: "prof-pedro-martins", servicoId: "serv-corte-tradicional", dia: futuro2, hora: "09:00", status: "confirmado" },
    { id: "ag-013", consumidorNome: "Bruno Carvalho", consumidorWhatsapp: "(11) 98123-4504", profissionalId: "prof-joao-silva", servicoId: "serv-barba", dia: futuro3, hora: "13:30", status: "pendente" },
    { id: "ag-014", consumidorNome: "Felipe Nogueira", consumidorWhatsapp: "(11) 98123-4502", profissionalId: "prof-rafael-costa", servicoId: "serv-corte-barba", dia: futuro4, hora: "15:00", status: "confirmado" },
  ];

  return construirAgendamentosEConsumidores(TENANT_DOM_NAVALHA, rascunhos, duracaoPorServico, precoPorServico);
}

function gerarAgendamentosEConsumidoresClinica(servicos: Servico[]) {
  const doTenant = servicos.filter((s) => s.tenantId === TENANT_CLINICA_SORRISO_LEVE);
  const duracaoPorServico = new Map(doTenant.map((s) => [s.id, s.duracaoMinutos]));
  const precoPorServico = new Map(doTenant.map((s) => [s.id, s.precoCentavos]));

  const [passado1] = diasUteisPassados(1, DIAS_SEG_A_SEX);
  const [hoje, futuro1, futuro2, futuro3] = proximosDiasUteis(0, 4, DIAS_SEG_A_SEX);

  const rascunhos: RascunhoAgendamento[] = [
    { id: "ag-c001", consumidorNome: "Helena Duarte", consumidorWhatsapp: "(11) 97123-9001", profissionalId: "prof-mariana-alves", servicoId: "serv-limpeza", dia: passado1, hora: "09:00", status: "concluido" },
    { id: "ag-c002", consumidorNome: "Otávio Ramos", consumidorWhatsapp: "(11) 97123-9002", profissionalId: "prof-lucas-ferreira", servicoId: "serv-avaliacao-inicial", dia: passado1, hora: "14:00", status: "nao_compareceu" },
    { id: "ag-c003", consumidorNome: "Beatriz Nogueira", consumidorWhatsapp: "(11) 97123-9003", profissionalId: "prof-mariana-alves", servicoId: "serv-avaliacao-inicial", dia: hoje, hora: "09:00", status: "confirmado" },
    { id: "ag-c004", consumidorNome: "Helena Duarte", consumidorWhatsapp: "(11) 97123-9001", profissionalId: "prof-mariana-alves", servicoId: "serv-clareamento", dia: hoje, hora: "10:30", status: "pendente" },
    { id: "ag-c005", consumidorNome: "Otávio Ramos", consumidorWhatsapp: "(11) 97123-9002", profissionalId: "prof-lucas-ferreira", servicoId: "serv-limpeza", dia: futuro1, hora: "08:30", status: "confirmado" },
    { id: "ag-c006", consumidorNome: "Beatriz Nogueira", consumidorWhatsapp: "(11) 97123-9003", profissionalId: "prof-mariana-alves", servicoId: "serv-limpeza", dia: futuro2, hora: "11:00", status: "pendente" },
    { id: "ag-c007", consumidorNome: "Helena Duarte", consumidorWhatsapp: "(11) 97123-9001", profissionalId: "prof-lucas-ferreira", servicoId: "serv-avaliacao-inicial", dia: futuro3, hora: "15:00", status: "confirmado" },
  ];

  return construirAgendamentosEConsumidores(TENANT_CLINICA_SORRISO_LEVE, rascunhos, duracaoPorServico, precoPorServico);
}

function gerarAgendamentosEConsumidoresJR(servicos: Servico[]) {
  const doTenant = servicos.filter((s) => s.tenantId === TENANT_BARBEARIA_JR);
  const duracaoPorServico = new Map(doTenant.map((s) => [s.id, s.duracaoMinutos]));
  const precoPorServico = new Map(doTenant.map((s) => [s.id, s.precoCentavos]));

  const [passado1] = diasUteisPassados(1, DIAS_SEG_A_SAB);
  const [hoje, futuro1, futuro2] = proximosDiasUteis(0, 3, DIAS_SEG_A_SAB);

  // Mesmo whatsapp de "Rodrigo Lima" (Dom Navalha) aparece aqui de propósito —
  // prova que o isolamento é por tenant, não por telefone.
  const rascunhos: RascunhoAgendamento[] = [
    { id: "ag-jr001", consumidorNome: "Rodrigo Lima", consumidorWhatsapp: "(11) 98123-4503", profissionalId: "prof-jonas-ribeiro", servicoId: "serv-jr-combo", dia: passado1, hora: "14:00", status: "concluido" },
    { id: "ag-jr002", consumidorNome: "Vinícius Prado", consumidorWhatsapp: "(11) 96123-7701", profissionalId: "prof-kayky-souza", servicoId: "serv-jr-corte", dia: passado1, hora: "17:00", status: "concluido" },
    { id: "ag-jr003", consumidorNome: "Igor Batista", consumidorWhatsapp: "(11) 96123-7702", profissionalId: "prof-jonas-ribeiro", servicoId: "serv-jr-barba", dia: hoje, hora: "11:00", status: "confirmado" },
    { id: "ag-jr004", consumidorNome: "Vinícius Prado", consumidorWhatsapp: "(11) 96123-7701", profissionalId: "prof-kayky-souza", servicoId: "serv-jr-combo", dia: futuro1, hora: "15:00", status: "pendente" },
    { id: "ag-jr005", consumidorNome: "Igor Batista", consumidorWhatsapp: "(11) 96123-7702", profissionalId: "prof-jonas-ribeiro", servicoId: "serv-jr-corte", dia: futuro2, hora: "18:00", status: "confirmado" },
  ];

  return construirAgendamentosEConsumidores(TENANT_BARBEARIA_JR, rascunhos, duracaoPorServico, precoPorServico);
}

function gerarAgendamentosEConsumidoresBastiao(servicos: Servico[]) {
  const doTenant = servicos.filter((s) => s.tenantId === TENANT_BARBEIRO_BASTIAO);
  const duracaoPorServico = new Map(doTenant.map((s) => [s.id, s.duracaoMinutos]));
  const precoPorServico = new Map(doTenant.map((s) => [s.id, s.precoCentavos]));

  const [passado1] = diasUteisPassados(1, DIAS_TER_A_SAB);
  const [hoje, futuro1] = proximosDiasUteis(0, 2, DIAS_TER_A_SAB);

  const rascunhos: RascunhoAgendamento[] = [
    { id: "ag-bb001", consumidorNome: "Cláudio Peixoto", consumidorWhatsapp: "(11) 95123-3301", profissionalId: "prof-bastiao-nunes", servicoId: "serv-bast-corte", dia: passado1, hora: "10:00", status: "concluido" },
    { id: "ag-bb002", consumidorNome: "Cláudio Peixoto", consumidorWhatsapp: "(11) 95123-3301", profissionalId: "prof-bastiao-nunes", servicoId: "serv-bast-barba", dia: hoje, hora: "09:30", status: "confirmado" },
    { id: "ag-bb003", consumidorNome: "Emerson Diniz", consumidorWhatsapp: "(11) 95123-3302", profissionalId: "prof-bastiao-nunes", servicoId: "serv-bast-corte", dia: futuro1, hora: "14:00", status: "pendente" },
  ];

  return construirAgendamentosEConsumidores(TENANT_BARBEIRO_BASTIAO, rascunhos, duracaoPorServico, precoPorServico);
}

export function gerarAgendamentosEConsumidoresSeed(): { agendamentos: Agendamento[]; consumidores: Consumidor[] } {
  const servicos = gerarServicosSeed();
  const grupos = [
    gerarAgendamentosEConsumidoresDomNavalha(servicos),
    gerarAgendamentosEConsumidoresClinica(servicos),
    gerarAgendamentosEConsumidoresJR(servicos),
    gerarAgendamentosEConsumidoresBastiao(servicos),
  ];
  return {
    agendamentos: grupos.flatMap((g) => g.agendamentos),
    consumidores: grupos.flatMap((g) => g.consumidores),
  };
}

export function gerarBloqueiosSeed(): Bloqueio[] {
  const [, , futuro2Navalha, futuro3Navalha] = proximosDiasUteis(0, 5, DIAS_TER_A_SAB);
  const [, futuro1Clinica] = proximosDiasUteis(0, 4, DIAS_SEG_A_SEX);
  const bloqueios: Bloqueio[] = [];
  if (futuro2Navalha) {
    bloqueios.push({
      id: "bloq-001",
      tenantId: TENANT_DOM_NAVALHA,
      profissionalId: "prof-rafael-costa",
      inicio: horaISO(futuro2Navalha, "10:00"),
      fim: horaISO(futuro2Navalha, "13:00"),
      motivo: "Curso de aperfeiçoamento",
    });
  }
  if (futuro3Navalha) {
    bloqueios.push({
      id: "bloq-002",
      tenantId: TENANT_DOM_NAVALHA,
      profissionalId: "prof-pedro-martins",
      inicio: horaISO(futuro3Navalha, "09:00"),
      fim: horaISO(futuro3Navalha, "10:30"),
      motivo: "Consulta médica",
    });
  }
  if (futuro1Clinica) {
    bloqueios.push({
      id: "bloq-c001",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      profissionalId: "prof-mariana-alves",
      inicio: horaISO(futuro1Clinica, "13:00"),
      fim: horaISO(futuro1Clinica, "14:00"),
      motivo: "Congresso odontológico",
    });
  }
  return bloqueios;
}

// ---------------------------------------------------------------------------
// Contas: administradores de plataforma, equipe dos estabelecimentos,
// memberships, convites e auditoria.
// ---------------------------------------------------------------------------

export function gerarUsuariosPlataformaSeed(): UsuarioPlataforma[] {
  return [
    {
      id: "mstr-ana-beatriz",
      nome: "Ana Beatriz Ferreira",
      email: "ana.ferreira@agendabarber.com",
      papel: "MASTER_OWNER",
      status: "ativo",
      permissoesExtras: [],
      criadoEm: addDays(new Date(), -600).toISOString(),
      ultimoAcessoSimuladoEm: addDays(new Date(), -1).toISOString(),
    },
    {
      id: "mstr-rodrigo-salles",
      nome: "Rodrigo Salles",
      email: "rodrigo.salles@agendabarber.com",
      papel: "MASTER_ADMIN",
      status: "ativo",
      // Pode gerenciar estabelecimentos, mas não administradores nem planos —
      // demonstra permissão configurável por administrador.
      permissoesExtras: ["estabelecimentos.gerenciar"],
      criadoEm: addDays(new Date(), -200).toISOString(),
      ultimoAcessoSimuladoEm: addDays(new Date(), -3).toISOString(),
    },
    {
      id: "mstr-camila-duarte",
      nome: "Camila Duarte",
      email: "camila.duarte@agendabarber.com",
      papel: "MASTER_SUPPORT",
      status: "ativo",
      permissoesExtras: [],
      criadoEm: addDays(new Date(), -90).toISOString(),
      ultimoAcessoSimuladoEm: addDays(new Date(), -7).toISOString(),
    },
  ];
}

export function gerarUsuariosEstabelecimentoSeed(): UsuarioEstabelecimento[] {
  return [
    { id: "user-marcelo-nogueira", nome: "Marcelo Nogueira", email: "marcelo@domnavalha.com.br", telefone: "(11) 98888-1111", status: "ativo", criadoEm: addDays(new Date(), -220).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -1).toISOString() },
    { id: "user-juliana-prado", nome: "Juliana Prado", email: "juliana@domnavalha.com.br", telefone: "(11) 98888-2222", status: "ativo", criadoEm: addDays(new Date(), -180).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -2).toISOString() },
    { id: "user-debora-alves", nome: "Débora Alves", email: "debora@domnavalha.com.br", telefone: "(11) 98888-3333", status: "ativo", criadoEm: addDays(new Date(), -150).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -5).toISOString() },
    { id: "user-joao-silva", nome: "João Silva", email: "joao.silva@domnavalha.com.br", telefone: "(11) 98888-4444", status: "ativo", criadoEm: addDays(new Date(), -220).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -1).toISOString() },
    { id: "user-mariana-alves", nome: "Dra. Mariana Alves", email: "mariana@sorrisoleve.com.br", telefone: "(11) 97777-1111", status: "ativo", criadoEm: addDays(new Date(), -60).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -1).toISOString() },
    { id: "user-lucas-ferreira", nome: "Dr. Lucas Ferreira", email: "lucas@sorrisoleve.com.br", telefone: "(11) 97777-2222", status: "ativo", criadoEm: addDays(new Date(), -60).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -4).toISOString() },
    { id: "user-renata-ribeiro", nome: "Renata Ribeiro", email: "renata@barbeariajr.com.br", telefone: "(11) 96222-1111", status: "ativo", criadoEm: addDays(new Date(), -45).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -1).toISOString() },
    { id: "user-jonas-ribeiro", nome: "Jonas Ribeiro", email: "jonas@barbeariajr.com.br", telefone: "(11) 96222-2222", status: "ativo", criadoEm: addDays(new Date(), -45).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -2).toISOString() },
    { id: "user-bastiao-nunes", nome: "Bastião Nunes", email: "bastiao@barbeirobastiao.com.br", telefone: "(11) 95111-1111", status: "ativo", criadoEm: addDays(new Date(), -90).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -3).toISOString() },
    // Convite ainda pendente (ver gerarConvitesSeed) — a conta já existe com
    // status "convidado" porque, na simulação, o registro é criado no convite e
    // só vira "ativo" quando a pessoa "aceita".
    { id: "user-felipe-cardoso", nome: "Felipe Cardoso", email: "felipe.cardoso@barbeariajr.com.br", telefone: "(11) 96222-3333", status: "convidado", criadoEm: addDays(new Date(), -2).toISOString() },
  ];
}

export function gerarMembershipsSeed(): Membership[] {
  return [
    { id: "memb-marcelo-dn", usuarioId: "user-marcelo-nogueira", tenantId: TENANT_DOM_NAVALHA, papel: "dono", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -220).toISOString() },
    { id: "memb-juliana-dn", usuarioId: "user-juliana-prado", tenantId: TENANT_DOM_NAVALHA, papel: "gerente", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -180).toISOString() },
    { id: "memb-debora-dn", usuarioId: "user-debora-alves", tenantId: TENANT_DOM_NAVALHA, papel: "recepcionista", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -150).toISOString() },
    { id: "memb-joao-dn", usuarioId: "user-joao-silva", tenantId: TENANT_DOM_NAVALHA, papel: "profissional", profissionalId: "prof-joao-silva", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -220).toISOString() },
    { id: "memb-mariana-cl", usuarioId: "user-mariana-alves", tenantId: TENANT_CLINICA_SORRISO_LEVE, papel: "dono", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -60).toISOString() },
    { id: "memb-lucas-cl", usuarioId: "user-lucas-ferreira", tenantId: TENANT_CLINICA_SORRISO_LEVE, papel: "profissional", profissionalId: "prof-lucas-ferreira", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -60).toISOString() },
    { id: "memb-renata-jr", usuarioId: "user-renata-ribeiro", tenantId: TENANT_BARBEARIA_JR, papel: "dono", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -45).toISOString() },
    // Exemplo de ajuste individual: Jonas é profissional, mas ganhou acesso a
    // relatórios (permissoesLiberadas) mesmo essa feature estando desativada
    // pelo master neste tenant (o cálculo de acesso bloquearia de qualquer forma
    // pela feature — este registro mostra que "liberação de papel" e "feature
    // ligada" são checagens independentes).
    { id: "memb-jonas-jr", usuarioId: "user-jonas-ribeiro", tenantId: TENANT_BARBEARIA_JR, papel: "profissional", profissionalId: "prof-jonas-ribeiro", permissoesLiberadas: ["relatorios.visualizar"], permissoesNegadas: [], criadoEm: addDays(new Date(), -45).toISOString() },
    { id: "memb-bastiao-bb", usuarioId: "user-bastiao-nunes", tenantId: TENANT_BARBEIRO_BASTIAO, papel: "dono", profissionalId: "prof-bastiao-nunes", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -90).toISOString() },
  ];
}

export function gerarConvitesSeed(): Convite[] {
  return [
    {
      id: "conv-jonas-jr",
      tipo: "estabelecimento",
      nome: "Jonas Ribeiro",
      email: "jonas@barbeariajr.com.br",
      tenantId: TENANT_BARBEARIA_JR,
      papel: "profissional",
      status: "aceito",
      token: "tok-conv-jonas-jr",
      criadoEm: addDays(new Date(), -46).toISOString(),
      expiraEm: addDays(new Date(), -39).toISOString(),
      aceitoEm: addDays(new Date(), -45).toISOString(),
      usuarioIdGerado: "user-jonas-ribeiro",
    },
    {
      id: "conv-felipe-jr",
      tipo: "estabelecimento",
      nome: "Felipe Cardoso",
      email: "felipe.cardoso@barbeariajr.com.br",
      tenantId: TENANT_BARBEARIA_JR,
      papel: "recepcionista",
      status: "pendente",
      token: "tok-conv-felipe-jr",
      criadoEm: addDays(new Date(), -2).toISOString(),
      expiraEm: addDays(new Date(), 5).toISOString(),
    },
    {
      id: "conv-antigo-vintage",
      tipo: "estabelecimento",
      nome: "Sérgio Matos",
      email: "sergio@barbeariavintage.com.br",
      tenantId: TENANT_BARBEARIA_VINTAGE,
      papel: "dono",
      status: "expirado",
      token: "tok-conv-antigo-vintage",
      criadoEm: addDays(new Date(), -410).toISOString(),
      expiraEm: addDays(new Date(), -403).toISOString(),
    },
    {
      id: "conv-rodrigo-master",
      tipo: "plataforma",
      nome: "Rodrigo Salles",
      email: "rodrigo.salles@agendabarber.com",
      papel: "MASTER_ADMIN",
      status: "aceito",
      token: "tok-conv-rodrigo-master",
      criadoEm: addDays(new Date(), -201).toISOString(),
      expiraEm: addDays(new Date(), -194).toISOString(),
      aceitoEm: addDays(new Date(), -200).toISOString(),
      usuarioIdGerado: "mstr-rodrigo-salles",
    },
  ];
}

export function gerarAuditoriaSeed(): RegistroAuditoria[] {
  const feature: Feature = "relatorios";
  return [
    {
      id: "audit-001",
      em: addDays(new Date(), -220).toISOString(),
      acao: "tenant.criado",
      usuarioResponsavelId: "mstr-ana-beatriz",
      usuarioResponsavelNome: "Ana Beatriz Ferreira",
      tenantId: TENANT_DOM_NAVALHA,
      resumo: "Estabelecimento Barbearia Dom Navalha criado com plano Pro.",
    },
    {
      id: "audit-002",
      em: addDays(new Date(), -60).toISOString(),
      acao: "tenant.criado",
      usuarioResponsavelId: "mstr-ana-beatriz",
      usuarioResponsavelNome: "Ana Beatriz Ferreira",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      resumo: "Estabelecimento Clínica Sorriso Leve criado com plano Equipe.",
    },
    {
      id: "audit-003",
      em: addDays(new Date(), -45).toISOString(),
      acao: "tenant.criado",
      usuarioResponsavelId: "mstr-rodrigo-salles",
      usuarioResponsavelNome: "Rodrigo Salles",
      tenantId: TENANT_BARBEARIA_JR,
      resumo: "Estabelecimento Barbearia JR criado com plano Equipe.",
    },
    {
      id: "audit-004",
      em: addDays(new Date(), -44).toISOString(),
      acao: "tenant.feature_alterada",
      usuarioResponsavelId: "mstr-rodrigo-salles",
      usuarioResponsavelNome: "Rodrigo Salles",
      tenantId: TENANT_BARBEARIA_JR,
      resumo: "Módulo de relatórios desativado por exceção.",
      dadosAnteriores: { featuresDesativadas: [] },
      dadosPosteriores: { featuresDesativadas: [feature] },
    },
    {
      id: "audit-005",
      em: addDays(new Date(), -30).toISOString(),
      acao: "tenant.suspenso",
      usuarioResponsavelId: "mstr-ana-beatriz",
      usuarioResponsavelNome: "Ana Beatriz Ferreira",
      tenantId: TENANT_BARBEARIA_VINTAGE,
      resumo: "Estabelecimento suspenso por inadimplência.",
      dadosAnteriores: { status: "inadimplente" },
      dadosPosteriores: { status: "suspenso", motivoSuspensao: "Pagamento em atraso há mais de 30 dias." },
    },
    {
      id: "audit-006",
      em: addDays(new Date(), -7).toISOString(),
      acao: "suporte.acessado",
      usuarioResponsavelId: "mstr-camila-duarte",
      usuarioResponsavelNome: "Camila Duarte",
      tenantId: TENANT_DOM_NAVALHA,
      resumo: "Acesso de suporte para investigar dúvida sobre remarcação.",
    },
    {
      id: "audit-007",
      em: addDays(new Date(), -2).toISOString(),
      acao: "usuario.convidado",
      usuarioResponsavelId: "user-renata-ribeiro",
      usuarioResponsavelNome: "Renata Ribeiro",
      tenantId: TENANT_BARBEARIA_JR,
      resumo: "Convite de recepcionista enviado para Felipe Cardoso.",
    },
  ];
}

let seedCompletoCache: {
  estabelecimentos: Estabelecimento[];
  profissionais: Profissional[];
  servicos: Servico[];
  agendamentos: Agendamento[];
  consumidores: Consumidor[];
  bloqueios: Bloqueio[];
  unidades: Unidade[];
  recursos: Recurso[];
  usuariosPlataforma: UsuarioPlataforma[];
  usuariosEstabelecimento: UsuarioEstabelecimento[];
  memberships: Membership[];
  convites: Convite[];
  auditoria: RegistroAuditoria[];
} | null = null;

/** Memoiza a geração para que agendamentos e consumidores (que são derivados
 * juntos) fiquem consistentes mesmo quando cada repositório lê sua própria
 * coleção. */
export function obterSeedCompleto() {
  if (!seedCompletoCache) {
    const { agendamentos, consumidores } = gerarAgendamentosEConsumidoresSeed();
    seedCompletoCache = {
      estabelecimentos: gerarEstabelecimentosSeed(),
      profissionais: gerarProfissionaisSeed(),
      servicos: gerarServicosSeed(),
      agendamentos,
      consumidores,
      bloqueios: gerarBloqueiosSeed(),
      unidades: gerarUnidadesSeed(),
      recursos: gerarRecursosSeed(),
      usuariosPlataforma: gerarUsuariosPlataformaSeed(),
      usuariosEstabelecimento: gerarUsuariosEstabelecimentoSeed(),
      memberships: gerarMembershipsSeed(),
      convites: gerarConvitesSeed(),
      auditoria: gerarAuditoriaSeed(),
    };
  }
  return seedCompletoCache;
}

function slugifyNome(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-");
}
