// Sanitização do parâmetro de retorno pós-login (`?next=`) — único ponto que
// decide se um destino é "interno o suficiente" para redirecionar depois de
// autenticar. Nunca aceitar um valor que o navegador possa interpretar como
// URL absoluta (open redirect): sem protocolo, sem `//` (protocol-relative),
// sem backslash (alguns navegadores normalizam `\` para `/`, um truque
// conhecido para disfarçar `//host` como `/\host`).
/** Destino de quem entra sem um `next` válido: o resumo do dia. */
export const ROTA_PADRAO_POS_LOGIN = "/conta/visao-geral";

/** Destino logo depois do cadastro: `/conta`, que leva ao início do perfil
 * (o roteiro de primeiros passos fica em Configurações → Estabelecimento). */
export const ROTA_POS_CADASTRO = "/conta";

export function sanitizarDestinoInterno(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  if (!bruto.startsWith("/")) return null;
  if (bruto.startsWith("//")) return null;
  if (bruto.includes("://")) return null;
  if (/[\\\s]/.test(bruto)) return null;
  return bruto;
}
