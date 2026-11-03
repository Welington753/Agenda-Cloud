// Tipos de portal-multisservicos-piloto.mjs, para o spec em TypeScript.
export {
  PREFIXO_DO_ENSAIO,
  VALIDADE_DO_BACKUP_CONFERIDO_MS,
  classificarFalha,
  codigoDeErroConhecido,
  compararServidores,
  conferirModo,
  destinoDoModo,
  lerRegistros,
} from './equipe-piloto.mjs';

export interface Etapa {
  readonly nome: 'portal' | 'multisservicos';
  readonly migration: string;
  readonly posteriores: readonly string[];
  readonly frase: string;
  readonly operacao: string;
  readonly esperadoAntes: string;
  readonly esperadoDepois: string;
  readonly prefixoDasPastas: string;
  readonly aplicacao: string;
  readonly colunasNovas: Readonly<Record<string, string[]>>;
  readonly tabelasNovas: readonly string[];
}

export const MIGRATION_PORTAL: string;
export const MIGRATION_NOMES_CONGELADOS: string;
export const ESTADO_ANTES: string;
export const ESTADO_INTERMEDIARIO: string;
export const ESTADO_FINAL: string;
export const ESTADOS: string[];
export const OPERACAO_CONFERIR: string;
export const ETAPAS: Readonly<{ portal: Etapa; multisservicos: Etapa }>;
export const APLICACOES_DAS_MIGRATIONS: string[];

export function escolherEtapa(nome: string | undefined): Etapa;
export function avaliarBackupConferido(
  etapa: Etapa,
  args: {
    manifesto: Record<string, any>;
    conferencia: Record<string, any>;
    sha256DoDump: string;
    sha256DoManifesto: string;
    commit: string;
    endpoint: string;
    modo: string;
    agora: number;
  },
): string[];
export function execucaoPendente(
  registros: Record<string, any>[],
  filtro: { endpoint: string; modo: string },
): { operacao: string; execucao: string; iniciadaEm: string } | null;
export function identificarEstado(args: { resultados: Record<string, boolean>; codigos?: (string | undefined)[] }): string;
export function decidirAplicacao(etapa: Etapa, estado: string): string;
export function conferirContas(etapa: Etapa, impacto: { proprietariosAtivos: number }): void;
export const CODIGOS_DE_DESFECHO: Readonly<Record<string, 0 | 1 | 2 | 3>>;
export function desfechoDoErro(codigo: string, execucao: null | "iniciada" | "aplicada"): string;
