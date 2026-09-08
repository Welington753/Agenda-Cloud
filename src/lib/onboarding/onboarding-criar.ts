// Caso de uso: transformar as respostas do onboarding demonstrável num
// estabelecimento de verdade (mesmas entidades/repositórios do resto do app) e
// devolver uma sessão pronta para `entrarComo`, sem pedir senha — reaproveita
// `criarEstabelecimentoComDono`, a mesma função que o master usa para cadastrar
// um estabelecimento.

import { criarEstabelecimentoComDono, type CriarEstabelecimentoInput } from "@/lib/estabelecimentos/criar-estabelecimento";
import { normalizarSlug } from "@/lib/estabelecimentos/validacao";
import { estabelecimentoRepository, membershipRepository, usuarioEstabelecimentoRepository } from "@/lib/repositories";
import { obterDefinicaoPlano } from "@/lib/planos";
import type { SessaoUsuario } from "@/lib/types";
import { planoSugerido, type RespostasOnboarding } from "./onboarding";
import { ativarChecklistPrimeirosPassos } from "./checklist-persistencia";

export type ResultadoCriacaoDemo = { sucesso: true; sessao: SessaoUsuario; slug: string } | { sucesso: false; erro: string };

const CORES_PADRAO_DEMO = { corPrincipal: "#1C1A17", corSecundaria: "#FAF7F2", corDestaque: "#2F6F4E" };
/** `.invalid` é o domínio reservado pela RFC 2606 para endereços que nunca devem
 * resolver de verdade — evita que uma conta de demonstração colida com um
 * e-mail real de alguém. */
const DOMINIO_EMAIL_DEMO = "demo.agenda-cloud.invalid";

function gerarSlugUnico(nomeNegocio: string): string {
  const base = normalizarSlug(nomeNegocio) || "meu-negocio";
  let candidato = base;
  let sufixo = 2;
  while (!estabelecimentoRepository.slugDisponivel(candidato)) {
    candidato = `${base}-${sufixo}`;
    sufixo += 1;
  }
  return candidato;
}

export function criarEstabelecimentoDemonstracao(respostas: RespostasOnboarding): ResultadoCriacaoDemo {
  if (!respostas.nomeNegocio.trim() || !respostas.segmento) {
    return { sucesso: false, erro: "Preencha o nome do negócio e o segmento antes de continuar." };
  }

  const slug = gerarSlugUnico(respostas.nomeNegocio);
  const plano = planoSugerido(respostas);
  const definicao = obterDefinicaoPlano(plano);
  const donoEmail = `dono-${slug}@${DOMINIO_EMAIL_DEMO}`;

  const input: CriarEstabelecimentoInput = {
    nome: respostas.nomeNegocio.trim(),
    nomeFantasia: respostas.nomeNegocio.trim(),
    categoria: respostas.segmento,
    documentoFiscal: "",
    telefone: "",
    email: "",
    endereco: "",
    fusoHorario: "America/Sao_Paulo",
    plano,
    featuresDesativadas: [],
    maxProfissionais: definicao.limites.maxProfissionais,
    maxUnidades: definicao.limites.maxUnidades,
    slug,
    logoIniciais: respostas.nomeNegocio.trim().slice(0, 2).toUpperCase(),
    ...CORES_PADRAO_DEMO,
    modelo: "moderno",
    textoApresentacao: `Agenda online de ${respostas.nomeNegocio.trim()}.`,
    instagram: "",
    donoNome: "Responsável pela demonstração",
    donoEmail,
    donoTelefone: "",
  };

  const resultado = criarEstabelecimentoComDono(input, { id: "onboarding-demo", nome: "Onboarding de demonstração" });
  if (!resultado.sucesso) return resultado;

  const usuario = usuarioEstabelecimentoRepository.obterPorEmail(donoEmail);
  if (!usuario) return { sucesso: false, erro: "Não foi possível localizar a conta criada para a demonstração." };

  // A demonstração ativa a conta na hora — sem convite por e-mail, sem senha:
  // o objetivo é entrar direto no painel para explorar o produto.
  usuarioEstabelecimentoRepository.atualizar(usuario.id, { status: "ativo" });

  const vinculo = membershipRepository.listarPorUsuario(usuario.id)[0];
  if (!vinculo) return { sucesso: false, erro: "Não foi possível localizar o vínculo criado para a demonstração." };

  const sessao: SessaoUsuario = {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    escopo: "estabelecimento",
    papel: vinculo.papel,
    tenantId: vinculo.tenantId,
    membershipId: vinculo.id,
  };

  ativarChecklistPrimeirosPassos(vinculo.tenantId);

  return { sucesso: true, sessao, slug };
}
