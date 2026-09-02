// Rascunho de personalização — o estado de edição de `/painel/personalizacao`
// antes de salvar. Extraído como função pura para ser testável sem depender
// de renderizar o componente: "cancelar" e "carregar" são a mesma operação
// (reconstruir o rascunho a partir do último estado salvo), e o preview é só
// esse rascunho aplicado sobre o estabelecimento real, sem tocar o repository.

import type { Estabelecimento, ModeloPaginaPublica } from "@/lib/types";

type SecaoId = "servicos" | "equipe" | "apresentacao" | "fotos";

export interface RascunhoPersonalizacao {
  modelo: ModeloPaginaPublica;
  logoIniciais: string;
  logoUrl?: string;
  corPrincipal: string;
  corSecundaria: string;
  corDestaque: string;
  fotos: string[];
  ordemSecoes: SecaoId[];
  rodapePersonalizado: string;
  ocultarMarca: boolean;
}

export const ORDEM_SECOES_PADRAO_RASCUNHO: SecaoId[] = ["apresentacao", "servicos", "equipe", "fotos"];

/** Usada tanto para carregar a tela quanto para "Cancelar alterações" — as
 * duas operações restauram exatamente o último estado salvo. */
export function construirRascunhoPersonalizacao(estabelecimento: Estabelecimento): RascunhoPersonalizacao {
  const identidade = estabelecimento.identidadeVisual;
  const avancada = identidade.personalizacaoAvancada;
  return {
    modelo: identidade.modelo,
    logoIniciais: identidade.logoIniciais,
    logoUrl: identidade.logoUrl,
    corPrincipal: identidade.corPrincipal,
    corSecundaria: identidade.corSecundaria,
    corDestaque: identidade.corDestaque,
    fotos: [...identidade.fotos],
    ordemSecoes: avancada?.ordemSecoes ?? ORDEM_SECOES_PADRAO_RASCUNHO,
    rodapePersonalizado: avancada?.rodapePersonalizado ?? "",
    ocultarMarca: avancada?.ocultarMarcaPlataforma ?? false,
  };
}

export function rascunhosIguais(a: RascunhoPersonalizacao, b: RascunhoPersonalizacao): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Aplica o rascunho (aparência) sobre o estabelecimento real (conteúdo:
 * endereço, regras, serviços...) — usada só para montar o preview, nunca
 * gravada. Reaproveita exatamente os mesmos componentes `ModeloClassico`/
 * `ModeloModerno` da página pública real, para nunca existir um segundo
 * sistema paralelo de personalização. */
export function aplicarRascunhoNaIdentidade(
  estabelecimento: Estabelecimento,
  rascunho: RascunhoPersonalizacao
): Estabelecimento {
  return {
    ...estabelecimento,
    identidadeVisual: {
      ...estabelecimento.identidadeVisual,
      modelo: rascunho.modelo,
      logoIniciais: rascunho.logoIniciais,
      logoUrl: rascunho.logoUrl,
      corPrincipal: rascunho.corPrincipal,
      corSecundaria: rascunho.corSecundaria,
      corDestaque: rascunho.corDestaque,
      fotos: rascunho.fotos,
      personalizacaoAvancada: {
        ordemSecoes: rascunho.ordemSecoes,
        rodapePersonalizado: rascunho.rodapePersonalizado.trim() || undefined,
        ocultarMarcaPlataforma: rascunho.ocultarMarca,
      },
    },
  };
}
