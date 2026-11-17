// Aparência (claro, escuro, seguir o aparelho ou azul e branco) — regras puras, testadas em
// tema.test.ts.
//
// ONDE VALE: só nas páginas REAIS que se declaram adaptáveis
// (<MarcadorAparencia />: /conta, login, cadastro e administração). O
// agendamento público (<MarcadorAparelho />) segue sempre o aparelho do
// cliente e ignora esta escolha. A demonstração (/painel, /master, /[slug],
// site) continua sempre clara: as cores dela não foram revisadas para o escuro.
//
// COMO É APLICADA: o `<html>` carrega `data-tema` = "claro" | "escuro" |
// "sistema". Em "sistema" é o próprio CSS que segue o aparelho
// (`prefers-color-scheme`), inclusive quando ele muda com a página aberta —
// nenhum JavaScript precisa acompanhar. O servidor sempre envia "sistema"
// (primeira visita segue o aparelho); o SCRIPT_APARENCIA, inline no
// `<head>`, troca pelo valor salvo ANTES da primeira pintura, então não há
// lampejo do tema errado nem diferença de hidratação no conteúdo.
//
// A escolha manual fica só neste navegador (localStorage): é preferência de
// quem está diante da tela, não da conta nem do estabelecimento.

//
// TEMA OPCIONAL "AZUL E BRANCO" (`data-tema="azul"`): claro, com menu lateral
// branco e azul nos destaques. Por ora só o portal da plataforma o desenha
// (<MarcadorTemaAzul />, ver globals.css); nas outras páginas adaptáveis o
// mesmo valor salvo aparece como o Claro, sem quebrar nada. Nunca é aplicado
// sozinho: só quem o escolhe no seletor passa a vê-lo.

export type PreferenciaAparencia = "claro" | "escuro" | "sistema" | "azul";

export const CHAVE_APARENCIA = "agenda-cloud:aparencia";

/** Valor que o servidor envia: segue o aparelho até haver escolha salva. */
export const APARENCIA_PADRAO: PreferenciaAparencia = "sistema";

type OpcaoAparencia = { valor: PreferenciaAparencia; rotulo: string };

/** Opções que valem em toda página adaptável. */
export const OPCOES_APARENCIA: readonly OpcaoAparencia[] = [
  { valor: "claro", rotulo: "Claro" },
  { valor: "escuro", rotulo: "Escuro" },
  { valor: "sistema", rotulo: "Seguir aparelho" },
];

export const OPCAO_AZUL: OpcaoAparencia = { valor: "azul", rotulo: "Azul e branco" };

/**
 * Opções do seletor. "Azul e branco" aparece onde o tema existe e também onde
 * ele já é a escolha salva (assim um rádio sempre fica marcado).
 */
export function opcoesAparencia(temaAzulDisponivel: boolean, atual: PreferenciaAparencia): readonly OpcaoAparencia[] {
  return temaAzulDisponivel || atual === "azul" ? [...OPCOES_APARENCIA, OPCAO_AZUL] : OPCOES_APARENCIA;
}

/** Valor salvo → preferência. Qualquer coisa estranha vira o padrão. */
export function lerPreferenciaSalva(bruto: string | null | undefined): PreferenciaAparencia {
  return bruto === "claro" || bruto === "escuro" || bruto === "sistema" || bruto === "azul" ? bruto : APARENCIA_PADRAO;
}

/**
 * Script inline do `<head>` (layout raiz). Roda enquanto o HTML é lido, antes
 * de qualquer pintura: lê a escolha salva e grava no `<html>`. Sem storage
 * (aba privada, bloqueio), fica o padrão do servidor. Mantido mínimo e sem
 * dependência: é texto puro, executado antes do React.
 */
export const SCRIPT_APARENCIA = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  CHAVE_APARENCIA,
)});if(v==="claro"||v==="escuro"||v==="sistema"||v==="azul")document.documentElement.setAttribute("data-tema",v)}catch(e){}})()`;
