// Classes dos botões e faixas da página inicial. A página usa os tokens da
// área real (globals.css): faixa escura `chrome` (a mesma da lateral da
// /conta e do painel do login) e corpo creme `paper`.
//
// Botões próprios em vez de `LinkBotao`: sobre a faixa escura o principal é
// claro (como no tema escuro da área real), e no creme o principal usa o tom
// escuro do destaque (`accent-hover`), porque texto branco sobre o tom
// principal fica abaixo de 4,5:1 (mesmo motivo de backend/src/email/marca.ts).
const BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] px-5 py-2.5 text-base font-semibold transition-colors";

/** Principal sobre a faixa escura: fundo creme, texto tinta. */
export const BOTAO_CLARO = `${BASE} bg-paper text-ink hover:bg-paper-muted`;
/** Secundário sobre a faixa escura: contorno. */
export const BOTAO_CONTORNO_ESCURO = `${BASE} border border-chrome-ink-soft/50 text-chrome-ink hover:bg-chrome-hover`;
/** Principal sobre o creme. */
export const BOTAO_PRINCIPAL = `${BASE} bg-[color:var(--color-accent-hover)] text-on-accent hover:bg-ink`;

/** Faixa escura: foco visível em branco, não no destaque. */
export const FAIXA_ESCURA =
  "bg-chrome text-chrome-ink [&_:focus-visible]:outline-[color:var(--color-chrome-focus)]";

/** Link de texto sobre a faixa escura. */
export const LINK_ESCURO = "font-semibold text-chrome-ink underline decoration-chrome-ink-soft/60 underline-offset-4 hover:decoration-chrome-ink";
