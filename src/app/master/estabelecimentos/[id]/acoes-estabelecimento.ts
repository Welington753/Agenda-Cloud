// Ações administrativas do master sobre um estabelecimento: alteração de
// plano/features, suspensão/reativação (ambas com registro de auditoria) e
// aceite/reenvio de convite — extraídas da página de detalhe para isolar a
// regra de negócio (o que muda e o que vira registro de auditoria) da UI.

import { auditoriaRepository, conviteRepository, estabelecimentoRepository, usuarioEstabelecimentoRepository } from "@/lib/repositories";
import { obterDefinicaoPlano } from "@/lib/planos";
import type { CodigoPlano, Convite, Estabelecimento, Feature, Membership, UsuarioEstabelecimento } from "@/lib/types";

export interface AutorAcao {
  id: string;
  nome: string;
}

export interface MembroEquipe {
  membership: Membership;
  usuario: UsuarioEstabelecimento | undefined;
}

/** Atualiza plano/features/limites e registra auditoria só para o que
 * realmente mudou (plano e features são comparados separadamente, cada um
 * gera sua própria entrada quando muda). */
export function salvarPlanoEFeatures(
  tenantId: string,
  estabelecimento: Estabelecimento,
  novoPlano: CodigoPlano,
  novasFeaturesDesativadas: Feature[],
  novosLimites: { maxProfissionais: number; maxUnidades: number },
  autor: AutorAcao
): void {
  const planoAnterior = estabelecimento.plano;
  const featuresAnteriores = estabelecimento.featuresDesativadas;
  estabelecimentoRepository.atualizar(tenantId, {
    plano: novoPlano,
    featuresDesativadas: novasFeaturesDesativadas,
    limites: novosLimites,
  });
  if (planoAnterior !== novoPlano) {
    auditoriaRepository.registrar({
      acao: "tenant.plano_alterado",
      usuarioResponsavelId: autor.id,
      usuarioResponsavelNome: autor.nome,
      tenantId,
      resumo: `Plano alterado de ${obterDefinicaoPlano(planoAnterior).nome} para ${obterDefinicaoPlano(novoPlano).nome}.`,
      dadosAnteriores: { plano: planoAnterior },
      dadosPosteriores: { plano: novoPlano },
    });
  }
  if (JSON.stringify(featuresAnteriores) !== JSON.stringify(novasFeaturesDesativadas)) {
    auditoriaRepository.registrar({
      acao: "tenant.feature_alterada",
      usuarioResponsavelId: autor.id,
      usuarioResponsavelNome: autor.nome,
      tenantId,
      resumo: "Funcionalidades desativadas por exceção foram atualizadas.",
      dadosAnteriores: { featuresDesativadas: featuresAnteriores },
      dadosPosteriores: { featuresDesativadas: novasFeaturesDesativadas },
    });
  }
}

export function suspenderEstabelecimento(tenantId: string, estabelecimento: Estabelecimento, motivo: string, autor: AutorAcao): void {
  estabelecimentoRepository.atualizar(tenantId, { status: "suspenso", motivoSuspensao: motivo });
  auditoriaRepository.registrar({
    acao: "tenant.suspenso",
    usuarioResponsavelId: autor.id,
    usuarioResponsavelNome: autor.nome,
    tenantId,
    resumo: `Estabelecimento suspenso: ${motivo}`,
    dadosAnteriores: { status: estabelecimento.status },
    dadosPosteriores: { status: "suspenso", motivoSuspensao: motivo },
  });
}

export function reativarEstabelecimento(tenantId: string, estabelecimento: Estabelecimento, autor: AutorAcao): void {
  estabelecimentoRepository.atualizar(tenantId, { status: "ativo", motivoSuspensao: undefined });
  auditoriaRepository.registrar({
    acao: "tenant.reativado",
    usuarioResponsavelId: autor.id,
    usuarioResponsavelNome: autor.nome,
    tenantId,
    resumo: "Estabelecimento reativado.",
    dadosAnteriores: { status: estabelecimento.status },
    dadosPosteriores: { status: "ativo" },
  });
}

/** Retorna false (sem efeito colateral nenhum) se o convite não existir ou
 * não pertencer a um tenant — mesmo comportamento silencioso do original. */
export function aceitarConvite(convites: Convite[], equipe: MembroEquipe[], conviteId: string): boolean {
  const convite = convites.find((c) => c.id === conviteId);
  if (!convite || !convite.tenantId) return false;
  const usuarioAlvo = equipe.find((e) => e.usuario?.email === convite.email)?.usuario;
  if (usuarioAlvo) {
    usuarioEstabelecimentoRepository.atualizar(usuarioAlvo.id, { status: "ativo" });
  }
  conviteRepository.atualizarStatus(convite.id, "aceito", {
    aceitoEm: new Date().toISOString(),
    usuarioIdGerado: usuarioAlvo?.id,
  });
  return true;
}

/** Retorna false quando o convite não está pendente/expirado (repositório
 * recusa o reenvio nesse caso). */
export function reenviarConvite(conviteId: string): boolean {
  return Boolean(conviteRepository.reenviar(conviteId));
}
