// Entrada oculta da URL do provisionamento MASTER_OWNER
// (promover-master-owner.mjs). Separada para ser testada sem banco nem rede.
// Nada aqui imprime ou grava o que foi digitado ou colado; os diagnósticos
// dizem só a categoria do problema.

export class Parada extends Error {}

const ESQUEMA = /postgres(?:ql)?:\/\//gi;
// C0 (inclusive tab, CR e LF no meio), DEL e C1. Intencional.
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;
const CTRL_V = "\u0016";

/** Motivos mostrados ao operador: categoria do problema, nunca o conteúdo. */
export const MOTIVOS = {
  ERR_URL_VAZIA: "entrada vazia: nenhuma URL foi recebida antes do Enter",
  ERR_URL_CTRL_V_SEM_COLAGEM:
    "Ctrl+V chegou como tecla, sem colar (console clássico); use o Windows Terminal ou o botão direito",
  ERR_URL_CARACTERE_DE_CONTROLE: "a entrada tem caracteres de controle; copie e cole somente a URL",
  ERR_URL_MAIS_DE_UMA: "há mais de uma URL na entrada; cole uma única vez",
  ERR_URL_MAIS_DE_UMA_LINHA: "chegou texto depois do Enter; cole uma única linha e pressione Enter uma vez",
  ERR_URL_COM_TEXTO_EXTRA: "copie somente a URL, sem psql, aspas ou espaços",
  ERR_URL_INVALIDA: "a entrada não é uma URL válida",
  ERR_CONFIRMACAO_VAZIA: "confirmação vazia: nada foi digitado antes do Enter",
  ERR_CONFIRMACAO_CTRL_V_SEM_COLAGEM: "Ctrl+V chegou como tecla, sem colar; digite a frase",
  ERR_CONFIRMACAO_CARACTERE_DE_CONTROLE: "a confirmação tem caracteres de controle; digite a frase",
  ERR_CONFIRMACAO_DIFERENTE: "a frase digitada é diferente da pedida (maiúsculas, espaços e e-mail contam)",
  ERR_CONFIRMACAO_MAIS_DE_UMA_LINHA: "chegou texto depois do Enter na confirmação",
};

/**
 * Classifica a entrada sem alterá-la. Devolve o código do problema ou null.
 * Só espaços nas pontas são ignorados (o chamador usa `trim()`); nada é
 * removido do meio, e entre várias URLs nenhuma é escolhida.
 */
export function classificarEntrada(bruta) {
  const texto = bruta.trim();
  if (texto === "") return "ERR_URL_VAZIA";
  if (texto.includes(CTRL_V)) return "ERR_URL_CTRL_V_SEM_COLAGEM";
  if (CONTROLE.test(texto)) return "ERR_URL_CARACTERE_DE_CONTROLE";
  const esquemas = texto.match(ESQUEMA)?.length ?? 0;
  if (esquemas > 1) return "ERR_URL_MAIS_DE_UMA";
  if (!/^postgres(?:ql)?:\/\//i.test(texto) || /[\s"'`]/.test(texto)) return "ERR_URL_COM_TEXTO_EXTRA";
  try {
    new URL(texto);
  } catch {
    return "ERR_URL_INVALIDA";
  }
  return null;
}

// Depois do Enter, espera um pouco por restos de uma colagem com várias linhas.
const ESPERA_APOS_ENTER_MS = 250;

/**
 * Lê uma linha sempre em modo raw. As duas leituras do procedimento (URL e
 * confirmação) passam por aqui: no Windows, ler em modo de linha depois de uma
 * leitura em modo raw perdia a primeira linha digitada (a confirmação chegava
 * vazia no Enter seguinte). Rejeita (Parada) se chegar texto depois do Enter.
 */
function lerLinha(rotulo, { eco, codigoSobra, stdin = process.stdin, stdout = process.stdout, esperaAposEnterMs = ESPERA_APOS_ENTER_MS }) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) return reject(new Parada("ERR_TERMINAL_NAO_INTERATIVO"));
    stdout.write(rotulo);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let valor = "";
    let terminou = false;
    let sobra = false;
    const finalizar = (erro) => {
      stdin.off("data", aoReceber);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (erro) reject(erro);
      else if (sobra) reject(new Parada(codigoSobra));
      else resolve(valor);
    };
    const aoReceber = (dados) => {
      for (const ch of dados) {
        if (terminou) {
          if (!/\s/.test(ch)) sobra = true;
          continue;
        }
        if (ch === "\r" || ch === "\n") {
          terminou = true;
          setTimeout(() => finalizar(), esperaAposEnterMs);
          continue;
        }
        if (ch === "\u0003") return finalizar(new Parada("CANCELADO"));
        if (ch === "\u0008" || ch === "\u007f") {
          if (eco && valor.length > 0) stdout.write("\b \b");
          valor = valor.slice(0, -1);
          continue;
        }
        valor += ch;
        // Eco só do que é imprimível; controles entram no valor e fazem a
        // comparação falhar, mas não mexem no terminal.
        if (eco && !CONTROLE.test(ch)) stdout.write(ch);
      }
    };
    stdin.on("data", aoReceber);
  });
}

/** URL: sem eco. */
export function lerOculto(rotulo, opcoes = {}) {
  return lerLinha(rotulo, { ...opcoes, eco: false, codigoSobra: "ERR_URL_MAIS_DE_UMA_LINHA" });
}

/** Confirmação: com eco, também em modo raw (ver lerLinha). */
export function lerConfirmacao(rotulo, opcoes = {}) {
  return lerLinha(rotulo, { ...opcoes, eco: true, codigoSobra: "ERR_CONFIRMACAO_MAIS_DE_UMA_LINHA" });
}

/** Compara a resposta com a frase exata. Devolve o código do motivo ou null. */
export function conferirConfirmacao(resposta, frase) {
  if (resposta === frase) return null;
  if (resposta.trim() === "") return "ERR_CONFIRMACAO_VAZIA";
  if (resposta.includes(CTRL_V)) return "ERR_CONFIRMACAO_CTRL_V_SEM_COLAGEM";
  if (CONTROLE.test(resposta)) return "ERR_CONFIRMACAO_CARACTERE_DE_CONTROLE";
  return "ERR_CONFIRMACAO_DIFERENTE";
}
