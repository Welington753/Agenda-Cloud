// Tipos de promover-master-owner-entrada.mjs, para o spec em TypeScript.
export class Parada extends Error {}
export const MOTIVOS: Record<string, string>;
export function classificarEntrada(bruta: string): string | null;
export function lerOculto(
  rotulo: string,
  opcoes?: {
    stdin?: NodeJS.ReadStream | unknown;
    stdout?: { write(texto: string): unknown };
    esperaAposEnterMs?: number;
  },
): Promise<string>;
