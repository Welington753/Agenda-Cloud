// Logger do TypeORM que nunca escreve valor de parâmetro, senha, hash nem
// token (ver docs/plans/senha-do-dono-calendario-profissional.md).
//
// O logger padrão (`advanced-console`) imprime, numa query que falha, o SQL
// seguido de `-- PARAMETERS: [...]`, ou seja, os valores de bind: hash de
// senha, hash de token de sessão, nomes e telefones. Imprime também a
// mensagem do PostgreSQL, que pode repetir um valor (`invalid input syntax
// ...: "<valor>"`, `RAISE` de gatilho).
//
// Aqui fica o que serve para diagnóstico:
// - o SQL, que no código é sempre texto com `$1`, sem dados;
// - o tipo e o tamanho de cada parâmetro, nunca o valor;
// - do erro: o código SQLSTATE, a constraint, a tabela e a coluna;
// - a mensagem, com cada valor de parâmetro e tudo o que tem cara de hash ou
//   token trocado por `[omitido]`.
//
// O `detail` do PostgreSQL ("Failing row contains (...)", "Key (x)=(...)")
// nunca é escrito: ele repete a linha inteira.
//
// O mesmo resumo serve ao filtro de erros HTTP (common/database-error.filter.ts),
// porque o tratador padrão do Nest imprimiria o erro inteiro, com
// `parameters` e `driverError`.
import { Logger as NestLogger } from '@nestjs/common';
import type { Logger, LoggerOptions } from 'typeorm';

export const OMITIDO = '[omitido]';

/** Valores com cara de segredo, mesmo que não sejam parâmetro desta query. */
const PADROES_SECRETOS: readonly RegExp[] = [
  // Hash Argon2 no formato PHC ($argon2id$v=19$m=...,t=...,p=...$sal$hash).
  /\$argon2(?:id|i|d)\$[^\s"'(),]+/g,
  // Hash ou token em hexadecimal (SHA-256 do token de sessão, tokens de conta).
  /\b[0-9a-f]{32,}\b/gi,
  // Token longo em base64url, com letra e dígito (não pega nome de constraint).
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g,
];

/** Strings menores que isso não são segredo e trocá-las só atrapalharia a
 * leitura (`'ACTIVE'`, `'PIX'`). */
const TAMANHO_MINIMO_PARA_TROCAR = 4;

type Parametros = readonly unknown[] | Record<string, unknown> | undefined;

function valoresDe(parametros: Parametros): unknown[] {
  if (!parametros) return [];
  return Array.isArray(parametros) ? [...parametros] : Object.values(parametros);
}

function tipoDe(valor: unknown): string {
  if (valor === null) return 'null';
  if (valor === undefined) return 'undefined';
  if (typeof valor === 'string') return `string(${valor.length})`;
  if (valor instanceof Date) return 'Date';
  if (Buffer.isBuffer(valor)) return `Buffer(${valor.length})`;
  if (Array.isArray(valor)) return `array(${valor.length})`;
  return typeof valor;
}

/** `[string(24), string(97), Date]`: quantos parâmetros e de que tipo. */
export function resumoDosParametros(parametros: Parametros): string {
  return `[${valoresDe(parametros).map(tipoDe).join(', ')}]`;
}

function textosDe(valor: unknown): string[] {
  if (typeof valor === 'string') return [valor];
  if (Array.isArray(valor)) return valor.flatMap(textosDe);
  if (valor && typeof valor === 'object' && !(valor instanceof Date) && !Buffer.isBuffer(valor)) {
    try {
      return [JSON.stringify(valor)];
    } catch {
      return [];
    }
  }
  return [];
}

/** Troca, no texto, cada valor de parâmetro e cada coisa com cara de hash ou
 * token por `[omitido]`. */
export function semSegredos(texto: string, parametros?: Parametros): string {
  let limpo = texto;
  const valores = valoresDe(parametros)
    .flatMap(textosDe)
    .filter((v) => v.length >= TAMANHO_MINIMO_PARA_TROCAR)
    // Os mais longos antes: um valor que contém outro sai inteiro.
    .sort((a, b) => b.length - a.length);
  for (const valor of valores) limpo = limpo.split(valor).join(OMITIDO);
  for (const padrao of PADROES_SECRETOS) limpo = limpo.replace(padrao, OMITIDO);
  return limpo;
}

interface ErroDoDriver {
  code?: unknown;
  constraint?: unknown;
  table?: unknown;
  column?: unknown;
}

/** Campos do erro do PostgreSQL que identificam o problema sem repetir dado. */
function camposDoDriver(erro: unknown): string {
  const driver = (erro as { driverError?: ErroDoDriver } | null)?.driverError ?? (erro as ErroDoDriver | null);
  if (!driver || typeof driver !== 'object') return '';
  const partes: string[] = [];
  for (const campo of ['code', 'constraint', 'table', 'column'] as const) {
    const valor = driver[campo];
    if (typeof valor === 'string' && valor) partes.push(`${campo}=${valor}`);
  }
  return partes.join(' ');
}

/** Uma linha sobre o erro: nome, campos do PostgreSQL e mensagem limpa. */
export function resumoDoErro(erro: unknown, parametros?: Parametros): string {
  const nome = erro instanceof Error ? erro.name : 'Erro';
  const mensagem = erro instanceof Error ? erro.message : typeof erro === 'string' ? erro : '';
  const campos = camposDoDriver(erro);
  let linha = campos ? `${nome} (${campos})` : nome;
  if (mensagem) linha += `: ${semSegredos(mensagem, parametros)}`;
  return linha;
}

/** O SQL com o resumo dos parâmetros. Os valores nunca entram. */
export function resumoDaQuery(query: string, parametros?: Parametros): string {
  // O SQL é código, com `$1` no lugar dos dados: trocar valor de parâmetro
  // nele só apagaria literais legítimos. Os padrões de segredo valem, por
  // garantia.
  const sql = semSegredos(query.replace(/\s+/g, ' ').trim());
  return valoresDe(parametros).length ? `${sql} -- parâmetros: ${resumoDosParametros(parametros)}` : sql;
}

/** O que o erro de uma query que falhou permite dizer sem vazar dado. O erro
 * do TypeORM traz `query` e `parameters`; o do driver, só a mensagem. */
export function resumoDaFalha(erro: unknown, query?: string, parametros?: Parametros): string {
  const comQuery = erro as { query?: unknown; parameters?: Parametros } | null;
  const sql = query ?? (typeof comQuery?.query === 'string' ? comQuery.query : undefined);
  const params = parametros ?? comQuery?.parameters;
  const linhas = [`erro: ${resumoDoErro(erro, params)}`];
  if (sql) linhas.unshift(`query que falhou: ${resumoDaQuery(sql, params)}`);
  return linhas.join('\n');
}

/** A pilha sem a primeira linha (que repete a mensagem do erro). */
export function pilhaSemMensagem(erro: unknown): string | undefined {
  if (!(erro instanceof Error) || !erro.stack) return undefined;
  const chamadas = erro.stack.split('\n').filter((linha) => /^\s+at /.test(linha));
  return chamadas.length ? [erro.name, ...chamadas].join('\n') : undefined;
}

export class SafeTypeOrmLogger implements Logger {
  private readonly logger = new NestLogger('TypeORM');

  constructor(private readonly options: LoggerOptions = ['error', 'warn']) {}

  logQuery(query: string, parameters?: unknown[]) {
    if (this.habilitado('query')) this.logger.log(resumoDaQuery(query, parameters));
  }

  logQueryError(error: string | Error, query: string, parameters?: unknown[]) {
    if (this.habilitado('error')) this.logger.error(resumoDaFalha(error, query, parameters));
  }

  logQuerySlow(time: number, query: string, parameters?: unknown[]) {
    this.logger.warn(`query lenta (${time} ms): ${resumoDaQuery(query, parameters)}`);
  }

  logSchemaBuild(message: string) {
    if (this.habilitado('schema')) this.logger.log(semSegredos(message));
  }

  logMigration(message: string) {
    this.logger.log(semSegredos(message));
  }

  log(level: 'log' | 'info' | 'warn', message: unknown) {
    if (!this.habilitado(level)) return;
    const texto = semSegredos(typeof message === 'string' ? message : String(message));
    if (level === 'warn') this.logger.warn(texto);
    else this.logger.log(texto);
  }

  private habilitado(nivel: 'query' | 'error' | 'warn' | 'info' | 'log' | 'schema'): boolean {
    const o = this.options;
    return o === 'all' || (o === true && nivel !== 'schema') || (Array.isArray(o) && o.includes(nivel));
  }
}
