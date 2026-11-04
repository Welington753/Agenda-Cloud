// Tipos de comissoes-profissionais-piloto.mjs, para o spec em TypeScript.
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

export const MIGRATION: string;
export const FRASE: string;
export const OPERACAO: string;
export const ESPERADO_ANTES: string;
export const ESPERADO_DEPOIS: string;
export const ESTADOS: string[];
export const PREFIXO_DAS_PASTAS: string;
export const APLICACAO_DA_MIGRATION: string;
export const COLUNAS_NOVAS: Readonly<Record<string, string[]>>;
export const LINHAS_NOVAS: Readonly<Record<string, string[]>>;

export function avaliarBackupConferido(args: {
  manifesto: Record<string, any>;
  conferencia: Record<string, any>;
  sha256DoDump: string;
  sha256DoManifesto: string;
  commit: string;
  endpoint: string;
  modo: string;
  agora: number;
}): string[];
export function execucaoPendente(
  registros: Record<string, any>[],
  filtro: { endpoint: string; modo: string },
): { execucao: string; iniciadaEm: string } | null;
export function identificarEstado(args: { resultados: Record<string, boolean>; codigos?: (string | undefined)[] }): string;
export function decidirAplicacao(estado: string): string;
export const CODIGOS_DE_DESFECHO: Readonly<Record<string, 0 | 1 | 2 | 3>>;
export function desfechoDoErro(codigo: string, execucao: null | 'iniciada' | 'aplicada'): string;
export function contagensEsperadasDepois(contagens: Record<string, number>): Record<string, number>;
