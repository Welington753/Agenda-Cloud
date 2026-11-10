// Slug público do tenant (`Tenant.slug`, citext único no banco) — derivado de
// `businessName` no cadastro. Resolução de colisão é determinística (sufixo
// numérico incremental) e limitada (nunca loop infinito mesmo sob ataque ou
// bug de verificação).
import { isReservedSlug } from '../common/reserved-slugs.js';

const DIACRITICS = /[̀-ͯ]/g;
const INVALID_CHARS = /[^a-z0-9\s-]/g;
const WHITESPACE_OR_DASH_RUNS = /[\s-]+/g;
const EDGE_DASHES = /^-+|-+$/g;

const DEFAULT_MAX_SLUG_LENGTH = 63;

export function slugify(input: string, maxLength = DEFAULT_MAX_SLUG_LENGTH): string {
  const slug = input
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(INVALID_CHARS, ' ')
    .trim()
    .replace(WHITESPACE_OR_DASH_RUNS, '-')
    .replace(EDGE_DASHES, '')
    .slice(0, maxLength)
    .replace(EDGE_DASHES, '');

  if (slug.length === 0) {
    throw new Error('Não foi possível gerar um slug a partir do nome informado.');
  }

  return slug;
}

export const MAX_SLUG_COLLISION_ATTEMPTS = 50;

/** Slug reservado (common/reserved-slugs.ts) conta como ocupado: "Portal"
 * vira `portal-2`, e o cadastro nunca é recusado pelo nome.
 * `exists` consulta o banco (ou qualquer fonte) para saber se o candidato já
 * está em uso. Nunca chamado além de `MAX_SLUG_COLLISION_ATTEMPTS` vezes —
 * protege contra loop infinito se `exists` sempre responder `true` (bug,
 * ataque, ou nome extremamente comum). */
export async function resolveSlug(
  baseSlug: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const ocupado = async (candidate: string) => isReservedSlug(candidate) || (await exists(candidate));
  if (!(await ocupado(baseSlug))) {
    return baseSlug;
  }

  for (let suffix = 2; suffix <= MAX_SLUG_COLLISION_ATTEMPTS; suffix++) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!(await ocupado(candidate))) {
      return candidate;
    }
  }

  throw new Error('Não foi possível gerar um slug único após várias tentativas.');
}
