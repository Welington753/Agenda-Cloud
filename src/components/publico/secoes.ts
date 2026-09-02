// Regras puras de composição da página pública — extraídas dos componentes
// visuais (`modelo-classico.tsx`/`modelo-moderno.tsx`) para serem testáveis
// sem depender de uma lib de renderização de componente (nenhuma foi
// instalada nesta etapa). Os dois modelos importam e usam exatamente as
// mesmas funções, então nunca divergem em qual seção aparece, em que ordem,
// ou quando o rodapé/marca da plataforma são exibidos.

import type { Estabelecimento, IdentidadeVisual, Profissional, Servico } from "@/lib/types";

export type SecaoId = "apresentacao" | "servicos" | "equipe" | "fotos";

export const ORDEM_SECOES_PADRAO: SecaoId[] = ["apresentacao", "servicos", "equipe", "fotos"];

export function obterOrdemSecoes(estabelecimento: Estabelecimento): SecaoId[] {
  return estabelecimento.identidadeVisual.personalizacaoAvancada?.ordemSecoes ?? ORDEM_SECOES_PADRAO;
}

export interface DadosParaSecoes {
  estabelecimento: Estabelecimento;
  servicos: Servico[];
  profissionais: Profissional[];
}

/** Uma seção só é visível quando tem dado real — nunca mostramos bloco vazio. */
export function secaoTemConteudo(secao: SecaoId, dados: DadosParaSecoes): boolean {
  switch (secao) {
    case "apresentacao":
      return Boolean(dados.estabelecimento.identidadeVisual.textoApresentacao.trim());
    case "servicos":
      return dados.servicos.length > 0;
    case "equipe":
      return dados.profissionais.length > 0;
    case "fotos":
      return dados.estabelecimento.identidadeVisual.fotos.length > 0;
    default:
      return false;
  }
}

/** Ordem configurada, filtrada para as seções que realmente têm o que mostrar. */
export function obterSecoesVisiveis(dados: DadosParaSecoes): SecaoId[] {
  return obterOrdemSecoes(dados.estabelecimento).filter((secao) => secaoTemConteudo(secao, dados));
}

export function exibirMarcaPlataforma(estabelecimento: Estabelecimento): boolean {
  return !estabelecimento.identidadeVisual.personalizacaoAvancada?.ocultarMarcaPlataforma;
}

export function obterRodapePersonalizado(estabelecimento: Estabelecimento): string | undefined {
  return estabelecimento.identidadeVisual.personalizacaoAvancada?.rodapePersonalizado;
}

export interface AntesDaVisita {
  politicaCancelamento?: string;
  orientacoes?: string;
}

/** Bloco "antes da visita": política de cancelamento é derivada da regra já
 * existente (nunca inventada) e orientações vêm de texto livre opcional. Só
 * existe quando há pelo menos um dos dois. */
export function obterAntesDaVisita(estabelecimento: Estabelecimento): AntesDaVisita | null {
  const prazo = estabelecimento.regras.prazoCancelamentoHoras;
  const politicaCancelamento =
    prazo > 0 ? `Cancelamentos até ${prazo} hora${prazo === 1 ? "" : "s"} antes do horário marcado.` : undefined;
  const orientacoes = estabelecimento.regras.orientacoesAntesVisita?.trim() || undefined;
  if (!politicaCancelamento && !orientacoes) return null;
  return { politicaCancelamento, orientacoes };
}

export type ResolucaoLogo = { tipo: "imagem"; url: string; alt: string } | { tipo: "iniciais"; texto: string };

/** Logo quando existe, iniciais como fallback — nunca os dois ao mesmo tempo,
 * nunca vazio. */
export function resolverLogo(identidade: IdentidadeVisual): ResolucaoLogo {
  if (identidade.logoUrl) {
    return { tipo: "imagem", url: identidade.logoUrl, alt: `Logo de ${identidade.nome}` };
  }
  return { tipo: "iniciais", texto: identidade.logoIniciais };
}

export function construirLinkAgendamento(slug: string): string {
  return `/${slug}/agendar`;
}
