// Regras puras da unificação de cadastros (ver
// docs/plans/clientes-ficha-e-duplicados.md): quais pares podem ser
// unificados, a versão da prévia e as recusas que a tela distingue pelo
// `code`.
//
// A versão da prévia é o hash (SHA-256) do CONTEÚDO apresentado, calculado
// pela mesma função na prévia e na confirmação. Uma mudança em agendamento,
// recebimento, comissão ou pedido público do secundário, ou nos dados dos
// dois cadastros, muda a versão: a confirmação com a versão antiga é
// recusada (409 `PREVIA_DESATUALIZADA`) sem transferir nada.
import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';

export type RelacaoParaUnificar = 'MESMO_TELEFONE' | 'NUMERO_PARECIDO' | 'MESMO_NOME';

export interface CadastroComparavel {
  whatsapp_normalized: string;
  name_key: string;
  phone_match_key: string | null;
}

/** Relações entre dois cadastros (as mesmas sugestões da ficha). Vazio: o
 * par não foi sugerido e não pode ser unificado. Chave de telefone nula
 * nunca agrupa. */
export function relacoesEntre(a: CadastroComparavel, b: CadastroComparavel): RelacaoParaUnificar[] {
  const relacoes: RelacaoParaUnificar[] = [];
  if (a.phone_match_key !== null && a.phone_match_key === b.phone_match_key) {
    relacoes.push(a.whatsapp_normalized === b.whatsapp_normalized ? 'MESMO_TELEFONE' : 'NUMERO_PARECIDO');
  }
  if (a.name_key === b.name_key) relacoes.push('MESMO_NOME');
  return relacoes;
}

export interface CadastroNaPrevia {
  id: string;
  name: string;
  whatsapp: string;
  email: string | null;
  unificado: boolean;
}

export interface AgendamentoNaPrevia {
  id: string;
  status: string;
  startAt: string;
  /** Preço de cada serviço (centavos inteiros), na ordem dos itens. */
  precos: (number | null)[];
}

export interface RecebimentoNaPrevia {
  id: string;
  appointmentId: string;
  amountCents: number;
  method: string;
  receivedOn: string;
  refunded: boolean;
}

export interface ComissaoNaPrevia {
  id: string;
  appointmentId: string;
  professionalCents: number;
  establishmentCents: number;
  status: string;
}

/** Tudo o que a prévia mostra e a confirmação confere. */
export interface ConteudoDaUnificacao {
  principal: CadastroNaPrevia;
  secundario: CadastroNaPrevia;
  agendamentos: AgendamentoNaPrevia[];
  recebimentos: RecebimentoNaPrevia[];
  comissoes: ComissaoNaPrevia[];
  pedidosPublicos: string[];
}

const porId = <T extends { id: string }>(lista: readonly T[]): T[] =>
  [...lista].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

/** Versão da prévia: o mesmo conteúdo dá sempre a mesma versão, em qualquer
 * ordem de leitura; qualquer campo apresentado que mude, muda a versão. */
export function versaoDaPrevia(conteudo: ConteudoDaUnificacao): string {
  const cadastro = (c: CadastroNaPrevia) => [c.id, c.name, c.whatsapp, c.email, c.unificado];
  const canonico = [
    cadastro(conteudo.principal),
    cadastro(conteudo.secundario),
    porId(conteudo.agendamentos).map((a) => [a.id, a.status, a.startAt, a.precos]),
    porId(conteudo.recebimentos).map((r) => [r.id, r.appointmentId, r.amountCents, r.method, r.receivedOn, r.refunded]),
    porId(conteudo.comissoes).map((c) => [c.id, c.appointmentId, c.professionalCents, c.establishmentCents, c.status]),
    [...conteudo.pedidosPublicos].sort(),
  ];
  return createHash('sha256').update(JSON.stringify(canonico)).digest('hex');
}

export interface ResumoDaTransferencia {
  agendamentos: number;
  concluidos: number;
  cancelados: number;
  faltas: number;
  /** Pendentes e confirmados (passados ou futuros). */
  outros: number;
  recebimentos: number;
  comissoes: number;
  pedidosPublicos: number;
}

export function resumoDaTransferencia(conteudo: ConteudoDaUnificacao): ResumoDaTransferencia {
  const conta = (status: string) => conteudo.agendamentos.filter((a) => a.status === status).length;
  const concluidos = conta('COMPLETED');
  const cancelados = conta('CANCELED');
  const faltas = conta('NO_SHOW');
  return {
    agendamentos: conteudo.agendamentos.length,
    concluidos,
    cancelados,
    faltas,
    outros: conteudo.agendamentos.length - concluidos - cancelados - faltas,
    recebimentos: conteudo.recebimentos.length,
    comissoes: conteudo.comissoes.length,
    pedidosPublicos: conteudo.pedidosPublicos.length,
  };
}

/** O que a tela mostra antes de confirmar. */
export interface PreviaDaUnificacao {
  principal: Omit<CadastroNaPrevia, 'unificado'>;
  secundario: Omit<CadastroNaPrevia, 'unificado'>;
  relacoes: RelacaoParaUnificar[];
  transferir: ResumoDaTransferencia;
  versaoDaPrevia: string;
}

export function previaDe(conteudo: ConteudoDaUnificacao, relacoes: RelacaoParaUnificar[]): PreviaDaUnificacao {
  const semMarca = ({ unificado: _unificado, ...resto }: CadastroNaPrevia) => resto;
  return {
    principal: semMarca(conteudo.principal),
    secundario: semMarca(conteudo.secundario),
    relacoes,
    transferir: resumoDaTransferencia(conteudo),
    versaoDaPrevia: versaoDaPrevia(conteudo),
  };
}

export const MESMO_CADASTRO_MESSAGE = 'Escolha dois cadastros diferentes para unificar.';
export const NAO_SUGERIDO_MESSAGE =
  'Só é possível unificar cadastros sugeridos: mesmo WhatsApp, número parecido ou mesmo nome.';
export const PREVIA_DESATUALIZADA_MESSAGE =
  'Os dados destes cadastros mudaram desde a prévia. Revise a prévia atualizada antes de confirmar.';

export function mesmoCadastro(): BadRequestException {
  return new BadRequestException({ statusCode: 400, code: 'MESMO_CADASTRO', message: MESMO_CADASTRO_MESSAGE });
}

export function naoSugerido(): ConflictException {
  return new ConflictException({ statusCode: 409, code: 'NAO_SUGERIDO', message: NAO_SUGERIDO_MESSAGE });
}

/** A confirmação chegou com uma versão antiga: nada foi transferido; a
 * resposta traz a prévia nova para a pessoa revisar. */
export function previaDesatualizada(previa: PreviaDaUnificacao): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'PREVIA_DESATUALIZADA',
    message: PREVIA_DESATUALIZADA_MESSAGE,
    previa,
  });
}
