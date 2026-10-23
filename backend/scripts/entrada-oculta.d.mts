// Tipos de entrada-oculta.mjs, para o spec em TypeScript.
export class Parada extends Error {}
export const MOTIVOS: Record<string, string>;
export function classificarEntrada(bruta: string): string | null;
export function conferirConfirmacao(resposta: string, frase: string): string | null;
type OpcoesDeLeitura = {
  stdin?: NodeJS.ReadStream | unknown;
  stdout?: { write(texto: string): unknown };
  esperaAposEnterMs?: number;
};
export function lerOculto(rotulo: string, opcoes?: OpcoesDeLeitura): Promise<string>;
export function lerConfirmacao(rotulo: string, opcoes?: OpcoesDeLeitura): Promise<string>;
