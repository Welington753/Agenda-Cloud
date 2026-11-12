export declare const VALIDADE_DA_LIBERACAO_MS: number;
export declare class RecusaDaLiberacao extends Error {
  codigo: string;
  constructor(codigo: string, mensagem: string);
}
export interface ClienteSql {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}
export declare function emitirLiberacaoDeEmergencia(
  cliente: ClienteSql,
  pedido: { email: string; motivo: string; agora?: Date },
): Promise<{ token: string; grantId: string; userId: string; expiraEm: Date }>;
export declare function caminhoDaLiberacao(token: string): string;
