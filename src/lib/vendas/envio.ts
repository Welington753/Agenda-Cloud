// Envio de uma operação que a pessoa pode repetir (nova venda, recebimento):
// regras puras da chave de pedido.
//
// - Uma chave por operação em andamento. Ela só muda depois de um resultado
//   CONFIRMADO pelo servidor (a operação foi gravada ou recusada), e a tela
//   pede a nova chave explicitamente (`novoEnvio`).
// - Resposta perdida (rede, ou `CHAVE_EM_USO`: o mesmo pedido ainda corre no
//   servidor): o resultado é desconhecido. O formulário trava e a única
//   repetição possível reenvia a MESMA chave com o MESMO corpo. O servidor
//   devolve o registro original se ele foi gravado; nunca cria outro.
// - Recusa definitiva (nada gravado): a pessoa corrige e confirma de novo.
//   A chave pode continuar a mesma, porque nada foi gravado com ela.
// - Nada é reenviado sozinho.
import type { ResultadoAcao } from "@/lib/administracao/api-contas";

export type EstadoDoEnvio<C> =
  | { fase: "pronto"; chave: string }
  | { fase: "enviando"; chave: string; corpo: C }
  | { fase: "incerto"; chave: string; corpo: C }
  | { fase: "recusado"; chave: string; resultado: Exclude<ResultadoAcao<unknown>, { tipo: "ok" }> };

export function novoEnvio<C>(chave: string): EstadoDoEnvio<C> {
  return { fase: "pronto", chave };
}

/**
 * Começa (ou repete) o envio. Com o resultado anterior desconhecido, o corpo
 * enviado é o ORIGINAL, não o proposto: a tela não consegue trocar o
 * conteúdo de um pedido que pode já ter sido gravado. `null`: já há um envio
 * em voo (clique duplo).
 */
export function iniciarEnvio<C>(estado: EstadoDoEnvio<C>, proposto: (chave: string) => C | null): { estado: EstadoDoEnvio<C>; corpo: C } | null {
  if (estado.fase === "enviando") return null;
  if (estado.fase === "incerto") return { estado: { fase: "enviando", chave: estado.chave, corpo: estado.corpo }, corpo: estado.corpo };
  const corpo = proposto(estado.chave);
  if (corpo === null) return null;
  return { estado: { fase: "enviando", chave: estado.chave, corpo }, corpo };
}

/** Resultado de rede ou de pedido igual ainda em andamento: desconhecido. */
export function resultadoDesconhecido(r: ResultadoAcao<unknown>): boolean {
  return r.tipo === "rede" || (r.tipo === "conflito" && r.codigo === "CHAVE_EM_USO");
}

/**
 * Estado depois da resposta. Sucesso não é tratado aqui: quem chama guarda o
 * registro confirmado e só depois pede `novoEnvio` com outra chave.
 */
export function concluirEnvio<C>(estado: EstadoDoEnvio<C>, r: Exclude<ResultadoAcao<unknown>, { tipo: "ok" }>): EstadoDoEnvio<C> {
  if (estado.fase !== "enviando") return estado;
  if (resultadoDesconhecido(r)) return { fase: "incerto", chave: estado.chave, corpo: estado.corpo };
  return { fase: "recusado", chave: estado.chave, resultado: r };
}

/** Enquanto o resultado é desconhecido ou o envio corre, o formulário não
 * muda (o que está na tela é o que foi enviado). */
export function formularioTravado(estado: EstadoDoEnvio<unknown>): boolean {
  return estado.fase === "enviando" || estado.fase === "incerto";
}
