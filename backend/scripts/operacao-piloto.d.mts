// Tipos de operacao-piloto.mjs, para o spec em TypeScript (só as funções puras).
export interface Destino {
  url: string;
  host: string;
  servidorTls: string;
  port: number;
  user: string;
  password: string;
  database: string;
  channelBinding: boolean;
}
export interface Fotografia {
  contagens: Record<string, number>;
  somas: Record<string, string>;
}
export const BANCO_PILOTO: string;
export const FORMATO_ENDPOINT_ID: RegExp;
export function pastaForaDoRepositorio(pasta: string, raiz?: string): boolean;
export function conferirDestino(bruta: string, ids: { endpointPiloto: string; endpointProibido: string }): Destino;
export function compararFotografias(
  antes: Fotografia,
  depois: Fotografia,
  opcoes?: { ignorarSomas?: string[]; ignorarTabelas?: string[]; novasPermitidas?: string[] },
): { iguais: boolean; contagensDiferentes: string[]; somasDiferentes: string[]; ausentes: string[]; sobrando: string[] };
export function conferirPendentes(args: {
  executadas: string[];
  carregadas: string[];
  esperadasAntes: string[];
  pendente?: string;
  pendentes?: string[];
}): string | null;
export function ambienteLibpq(
  destino: Destino & { ca?: string },
  raizes: string,
  aplicacao: string,
): Record<string, string>;
