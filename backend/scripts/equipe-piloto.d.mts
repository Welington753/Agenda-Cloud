// Tipos de equipe-piloto.mjs, para o spec em TypeScript.
import type { Destino } from './operacao-piloto.mjs';

export const MIGRATION: string;
export const FRASE: string;
export const OPERACAO: string;
export const ESPERADO_ANTES: string;
export const ESPERADO_DEPOIS: string;
export const PREFIXO_DO_ENSAIO: string;
export const PREFIXO_DAS_PASTAS: string;
export const APLICACAO_DA_MIGRATION: string;
export const VALIDADE_DO_BACKUP_CONFERIDO_MS: number;
export const TABELAS_ALTERADAS: string[];

export interface Lote {
  nome: string;
  rotulo: string;
  migrations: readonly string[];
  frase: string;
  operacao: string;
  esperadoAntes: string;
  esperadoDepois: string;
  prefixoDasPastas: string;
  aplicacaoDaMigration: string;
  aplicacaoDaConferencia: string;
  aplicacaoDoBackup: string;
  aplicacaoDaRestauracao: string;
  schema: string;
  publicacao: string;
  tabelasAlteradas: readonly string[];
  tabelasNovas: readonly string[];
  jaAplicado: string;
}
export const LOTES: Readonly<Record<'equipe' | 'acesso-recebimentos', Lote>>;
export function escolherLote(nome: unknown): Lote;

export interface AjusteDeEnsaio {
  endereco: string;
  caArquivo: string;
}
export function conferirModo(args: {
  modo: string;
  env: Record<string, string | undefined>;
  execArgv: string[];
  endpointPiloto: string;
}): AjusteDeEnsaio | null;
export function destinoDoModo<T extends Destino>(destino: T, ensaio: AjusteDeEnsaio | null, caPem?: string): T & { ca?: string };
export function avaliarBackupConferido(args: {
  manifesto: Record<string, any>;
  conferencia: Record<string, any>;
  sha256DoDump: string;
  sha256DoManifesto: string;
  commit: string;
  endpoint: string;
  modo: string;
  agora: number;
  lote?: Lote;
}): string[];
export function compararServidores(conferido: Record<string, any>, novo: Record<string, any>): string[];
export function classificarFalha(
  erro: unknown,
  opcoes: { iniciou: boolean },
): 'nada_aplicado' | 'recusada_pelo_banco' | 'incerto';
export function execucaoPendente(
  registros: Record<string, any>[],
  filtro: { endpoint: string; modo: string; lote?: Lote },
): { execucao: string; iniciadaEm: string } | null;
export function lerRegistros(texto: string): Record<string, any>[];
export function identificarEstado(conferencias: {
  before: boolean;
  after: boolean;
  codigos?: (string | undefined)[];
}): 'before' | 'after' | 'divergente' | 'nao_identificado';
export function codigoDeErroConhecido(erro: unknown): string | null;
