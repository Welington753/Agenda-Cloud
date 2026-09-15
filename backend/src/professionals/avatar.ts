// Derivação determinística de `avatarInitials`/`avatarColor` (Lote 6D.2).
//
// As duas colunas são NOT NULL sem default no schema real
// (`professionals.avatar_initials`, `professionals.avatar_color`), mas este
// lote não pede customização de avatar — inventar um formulário para isso
// seria escopo fora do pedido. Em vez de um dado fictício fixo (que violaria
// "não improvise dados fictícios para satisfazer constraints"), as duas
// colunas são calculadas a partir do nome real, sempre da mesma forma —
// nunca aleatório, nunca pedido à pessoa. Recalculado a cada mudança de nome
// (ver professionals.service.ts, `update`), para nunca ficar preso ao nome
// antigo.
const AVATAR_PALETTE: readonly string[] = [
  '#B5651D',
  '#3B5A6B',
  '#6B4226',
  '#1C6E8C',
  '#3E7C59',
  '#D4A017',
  '#8A6D3B',
  '#7C3AED',
  '#0F766E',
  '#B91C1C',
];

function initialsFromName(name: string): string {
  const partes = name.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** Hash simples e estável (mesma entrada sempre gera o mesmo índice) — não é
 * criptográfico, só precisa distribuir nomes diferentes pela paleta. */
function colorFromName(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function deriveAvatar(name: string): { avatarInitials: string; avatarColor: string } {
  return { avatarInitials: initialsFromName(name), avatarColor: colorFromName(name) };
}
