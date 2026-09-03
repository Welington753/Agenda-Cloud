// Caso de uso: criação de um estabelecimento pelo master, com unidade
// principal, dono convidado e registro de auditoria — extraído da tela
// "Novo estabelecimento" (src/app/master/estabelecimentos/novo/page.tsx) para
// isolar a regra de negócio da UI do assistente em etapas.

import {
  auditoriaRepository,
  conviteRepository,
  estabelecimentoRepository,
  membershipRepository,
  unidadeRepository,
  usuarioEstabelecimentoRepository,
} from "@/lib/repositories";
import { obterDefinicaoPlano } from "@/lib/planos";
import type { CategoriaNegocio, CodigoPlano, Estabelecimento, Feature, ModeloPaginaPublica } from "@/lib/types";

export interface CriarEstabelecimentoInput {
  nome: string;
  nomeFantasia: string;
  categoria: CategoriaNegocio;
  documentoFiscal: string;
  telefone: string;
  email: string;
  endereco: string;
  fusoHorario: string;
  plano: CodigoPlano;
  featuresDesativadas: Feature[];
  maxProfissionais: number;
  maxUnidades: number;
  slug: string;
  logoIniciais: string;
  corPrincipal: string;
  corSecundaria: string;
  corDestaque: string;
  modelo: ModeloPaginaPublica;
  textoApresentacao: string;
  instagram: string;
  donoNome: string;
  donoEmail: string;
  donoTelefone: string;
}

export interface CriarEstabelecimentoAutor {
  id: string;
  nome: string;
}

export type CriarEstabelecimentoResultado =
  | { sucesso: true; estabelecimento: Estabelecimento }
  | { sucesso: false; erro: string };

/** Só a criação do estabelecimento em si (primeira chamada de repositório) é
 * protegida por try/catch, preservando o comportamento original: se uma
 * chamada posterior (unidade, dono, membership, convite, auditoria) falhar,
 * o erro continua se propagando sem tratamento amigável — nenhum
 * comportamento novo foi introduzido aqui, só movido de lugar. */
export function criarEstabelecimentoComDono(
  input: CriarEstabelecimentoInput,
  autor: CriarEstabelecimentoAutor
): CriarEstabelecimentoResultado {
  const tenantId = `tenant-${input.slug}-${Date.now().toString(36)}`;
  const regrasIniciais = {
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
  };

  let estabelecimento: Estabelecimento;
  try {
    estabelecimento = estabelecimentoRepository.criar({
      tenantId,
      slug: input.slug,
      categoria: input.categoria,
      identidadeVisual: {
        nome: input.nome.trim(),
        nomeCurto: input.nomeFantasia.trim() || input.nome.trim(),
        logoIniciais: (input.logoIniciais.trim() || input.nome.slice(0, 2)).toUpperCase().slice(0, 3),
        corPrincipal: input.corPrincipal,
        corSecundaria: input.corSecundaria,
        corDestaque: input.corDestaque,
        estilo: "Definido pelo master no cadastro",
        modelo: input.modelo,
        endereco: input.endereco.trim(),
        telefone: input.telefone.trim(),
        email: input.email.trim() || undefined,
        redesSociais: input.instagram.trim() ? { instagram: input.instagram.trim() } : undefined,
        textoApresentacao: input.textoApresentacao.trim(),
        fotos: [],
      },
      documentoFiscal: input.documentoFiscal.trim() || undefined,
      fusoHorario: input.fusoHorario,
      horarioGeral: { diasFuncionamento: [1, 2, 3, 4, 5, 6], abertura: "09:00", fechamento: "19:00" },
      regras: regrasIniciais,
      plano: input.plano,
      featuresDesativadas: input.featuresDesativadas,
      limites: { maxProfissionais: input.maxProfissionais, maxUnidades: input.maxUnidades },
      status: "teste",
      criadoEm: new Date().toISOString(),
      quantidadeProfissionais: 0,
    });
  } catch (erro) {
    return {
      sucesso: false,
      erro: erro instanceof Error ? erro.message : "Não foi possível criar o estabelecimento.",
    };
  }

  unidadeRepository.criar({ tenantId, nome: "Unidade principal", endereco: input.endereco.trim(), principal: true });

  const donoUsuario = usuarioEstabelecimentoRepository.criar({
    nome: input.donoNome.trim(),
    email: input.donoEmail.trim(),
    telefone: input.donoTelefone.trim() || undefined,
    status: "convidado",
    criadoEm: new Date().toISOString(),
  });

  membershipRepository.criar({
    usuarioId: donoUsuario.id,
    tenantId,
    papel: "dono",
    permissoesLiberadas: [],
    permissoesNegadas: [],
  });

  conviteRepository.criar({
    tipo: "estabelecimento",
    nome: input.donoNome.trim(),
    email: input.donoEmail.trim(),
    tenantId,
    papel: "dono",
    expiraEm: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  auditoriaRepository.registrar({
    acao: "tenant.criado",
    usuarioResponsavelId: autor.id,
    usuarioResponsavelNome: autor.nome,
    tenantId,
    resumo: `Estabelecimento ${estabelecimento.identidadeVisual.nome} criado com plano ${obterDefinicaoPlano(input.plano).nome}.`,
  });

  return { sucesso: true, estabelecimento };
}
