// Tipos de backup-agendado-lib.mjs, para os specs em TypeScript.
import type { Destino, Fotografia } from './operacao-piloto.mjs';

export const REPOSITORIO_DE_OPERACAO: string;
export const REPOSITORIO_PUBLICO: string;
export const PAPEL_DE_BACKUP: string;
export const RETENCAO_DIARIA_DIAS: number;
export const RETENCAO_MENSAL_MESES: number;
export const ARQUIVOS: { dump: string; manifesto: string; resumo: string };
export const HASH_VAZIO: string;

export type DestinoLocal = Destino & { ca?: string; caArquivo?: string };
export interface Configuracao {
  modo: 'piloto' | 'ensaio';
  repositorio: string;
  apiDoGitHub: string;
  tokenDoGitHub: string;
  execucao: string;
  origem: DestinoLocal;
  restauracao: DestinoLocal;
  armazenamento: { endpoint: string; regiao: string; bucket: string; chaveId: string; chaveSecreta: string };
  cron: string;
  destinatario: string;
  commit: string;
  pastaTemporaria: string;
  binarios: { pgDump: string; pgRestore: string; age: string };
}
export interface ResultadoDoProcesso {
  codigo: number | null;
  stdout: string;
  stderr: string;
}
export type Executar = (executavel: string, args: string[], env?: Record<string, string>) => Promise<ResultadoDoProcesso>;
export type Buscar = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: Buffer; signal?: AbortSignal }) => Promise<Response>;
export interface Resumo {
  formato: string;
  completo: true;
  tipo: 'diario' | 'mensal';
  pontoDeRecuperacao: string;
  retencaoAte: string;
  commit: string;
  execucao: string;
  pgDump: number;
  servidor: string;
  tabelas: number;
  dumpClaroBytes: number;
  objetos: Record<'dump' | 'manifesto', { chave: string; bytes: number; sha256: string }>;
  duracoesMs: Record<string, number>;
}

export function conferirLoopback(bruta: string, caArquivo: string | undefined, codigo: string): DestinoLocal;
export function destinoDaRecuperacao(bruta: string, caArquivo?: string): DestinoLocal;
export function lerConfiguracao(env: Record<string, string | undefined>): Configuracao;
export function segredosDa(config: Configuracao): string[];
export function limparDetalhe(texto: unknown, segredos: string[], limite?: number): string;
export function conferirRepositorioPrivado(config: Configuracao, buscar?: Buscar): Promise<void>;
export function avaliarPapelSomenteLeitura(estado: Record<string, boolean | number> | undefined): string[];
export function planoDoObjeto(agora: Date, execucao: string): { tipo: 'diario' | 'mensal'; prefixo: string; retencaoAte: Date };
export function assinarS3(args: {
  metodo: string;
  url: string;
  cabecalhos?: Record<string, string>;
  hashDoCorpo: string;
  chaveId: string;
  chaveSecreta: string;
  regiao: string;
  servico?: string;
  agora: Date;
}): Record<string, string>;
export function clienteS3(
  armazenamento: Configuracao['armazenamento'],
  deps?: { buscar?: Buscar; agora?: () => Date },
): {
  enviar(chave: string, corpo: Buffer, opcoes: { retencaoAte: Date; tipo?: string }): Promise<{ status: number; ok: boolean }>;
  conferir(chave: string): Promise<{ status: number; cabecalhos: Record<string, string> }>;
  baixar(chave: string): Promise<{ status: number; corpo: Buffer | null }>;
};
export function conferirObjetoEnviado(
  head: { status: number | string; cabecalhos: Record<string, string> },
  esperado: { bytes: number; sha256: string; retencaoAte: Date },
): string[];
export const executar: Executar;
export function versaoMaior(saida: string | undefined): number | null;
export function sinalizarCron(url: string, status: string, opcoes?: { buscar?: Buscar; duracaoMs?: number }): Promise<boolean>;
export function restaurarEConferir(args: {
  dump: string;
  servidor: DestinoLocal;
  nomeDoBanco: string;
  esperado: Fotografia;
  pgRestore: string;
  criarBanco: boolean;
  executarProcesso?: Executar;
  log: (linha: string) => void;
  segredos?: string[];
  aposRestaurar?: (destino: DestinoLocal) => Promise<void>;
}): Promise<{ tabelas: number }>;
export function executarBackup(
  config: Configuracao,
  deps?: {
    executarProcesso?: Executar;
    buscar?: Buscar;
    agora?: () => Date;
    log?: (linha: string) => void;
    aoExportarSnapshot?: () => Promise<void>;
    aposRestaurar?: (destino: DestinoLocal) => Promise<void>;
  },
): Promise<Resumo>;
