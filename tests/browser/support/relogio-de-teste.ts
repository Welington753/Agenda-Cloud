// Lado do SPEC do relógio de teste (playwright.relogio-de-teste.config.ts):
// lê o deslocamento que a configuração calculou e passou ao backend, põe o
// navegador no mesmo instante e confere que os três (spec, navegador e
// backend) veem o mesmo "agora". O backend é deslocado por
// support/relogio-deslocado.mjs.
import { expect, type Page } from "@playwright/test";

const UM_MINUTO = 60_000;

function deslocamento(): number {
  const valor = Number(process.env.E2E_RELOGIO_DESLOCAMENTO_MS);
  expect(
    Number.isInteger(valor),
    "rode pela playwright.relogio-de-teste.config.ts (npm run test:browser:visao-geral ou :agenda-view)",
  ).toBe(true);
  return valor;
}

/** O "agora" do relógio de teste, pelo relógio do spec. */
export function agoraDoTeste(): Date {
  return new Date(Date.now() + deslocamento());
}

/**
 * Instala o relógio do navegador no "agora" do teste (correndo no ritmo
 * real) e o devolve. Chamar antes da primeira navegação da página.
 */
export async function instalarRelogioDeTeste(page: Page): Promise<Date> {
  const agora = agoraDoTeste();
  await page.clock.install({ time: agora });
  return agora;
}

/** Instante gerado pelo `new Date()` do BACKEND (ex.: `trialStartAt` do
 * cadastro) bate com o "agora" do teste. */
export function conferirRelogioDoBackend(instanteDoBackend: string): void {
  const diferenca = Math.abs(Date.parse(instanteDoBackend) - agoraDoTeste().getTime());
  expect(diferenca, "relógio do backend fora do relógio de teste").toBeLessThan(UM_MINUTO);
}

/** O relógio do navegador (já numa página carregada) bate com o do teste. */
export async function conferirRelogioDoNavegador(page: Page): Promise<void> {
  const doNavegador = await page.evaluate(() => Date.now());
  const diferenca = Math.abs(doNavegador - agoraDoTeste().getTime());
  expect(diferenca, "relógio do navegador fora do relógio de teste").toBeLessThan(UM_MINUTO);
}
