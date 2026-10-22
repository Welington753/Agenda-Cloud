// Aparência (claro, escuro ou seguir o aparelho) — regras puras, testadas em
// tema.test.ts.
//
// ONDE VALE: só nas páginas REAIS que se declaram adaptáveis
// (<MarcadorAparencia />: agendamento público, /conta, login, cadastro e
// administração). A demonstração (/painel, /master, /[slug], site) continua
// sempre clara: as cores dela não foram revisadas para o escuro.
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

export type PreferenciaAparencia = "claro" | "escuro" | "sistema";

export const CHAVE_APARENCIA = "agenda-cloud:aparencia";

/** Valor que o servidor envia: segue o aparelho até haver escolha salva. */
export const APARENCIA_PADRAO: PreferenciaAparencia = "sistema";

export const OPCOES_APARENCIA: readonly { valor: PreferenciaAparencia; rotulo: string }[] = [
  { valor: "claro", rotulo: "Claro" },
  { valor: "escuro", rotulo: "Escuro" },
  { valor: "sistema", rotulo: "Seguir aparelho" },
];

/** Valor salvo → preferência. Qualquer coisa estranha vira o padrão. */
export function lerPreferenciaSalva(bruto: string | null | undefined): PreferenciaAparencia {
  return bruto === "claro" || bruto === "escuro" || bruto === "sistema" ? bruto : APARENCIA_PADRAO;
}

/**
 * Script inline do `<head>` (layout raiz). Roda enquanto o HTML é lido, antes
 * de qualquer pintura: lê a escolha salva e grava no `<html>`. Sem storage
 * (aba privada, bloqueio), fica o padrão do servidor. Mantido mínimo e sem
 * dependência: é texto puro, executado antes do React.
 */
export const SCRIPT_APARENCIA = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  CHAVE_APARENCIA,
)});if(v==="claro"||v==="escuro"||v==="sistema")document.documentElement.setAttribute("data-tema",v)}catch(e){}})()`;
