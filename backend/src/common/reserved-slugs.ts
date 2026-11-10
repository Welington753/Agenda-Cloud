// Slugs que nenhum estabelecimento novo recebe (achado R6, ver
// docs/plans/estabelecimento-teste-e-slugs-reservados.md). Fonte única: o
// cadastro (`resolveSlug`, auth/slug.ts) e a conferência do piloto
// (scripts/lib/slugs-reservados-check.ts, cópia conferida por teste) leem
// daqui.
//
// O QUE ENTRA:
// - rotas fixas da raiz do web (`src/app/<pasta>`): `/<slug>` cairia na rota
//   fixa, nunca no estabelecimento;
// - entradas antigas que redirecionam (next.config, `redirects`);
// - os seis slugs da semente da demonstração (src/lib/seed/estabelecimentos.ts),
//   que `/<slug>` ainda serve.
// Pastas dinâmicas (`[slug]`) e grupos de rotas (`(area)`) não entram: não
// são endereços. `src/lib/agendamento-publico/slugs-reservados.test.ts`, no
// web, confere esta lista contra as pastas de `src/app` e a semente.
//
// Valores já na forma de `slugify` (minúsculas, `[a-z0-9-]`). Comparação
// sem diferença de maiúsculas, como a coluna `citext`.
//
// Um estabelecimento ANTIGO com slug reservado não é renomeado: continua em
// `/agendar/<slug>`, que é o endereço oficial.
import { ConflictException } from '@nestjs/common';

export const RESERVED_SLUGS: readonly string[] = [
  // Rotas fixas da raiz do web.
  '403',
  'agendar',
  'cadastro',
  'conta',
  'convite',
  'login',
  'master',
  'onboarding',
  'painel',
  'portal',
  'profissional',
  'redefinir-senha',
  'apple-icon',
  // Entradas antigas que redirecionam para o portal.
  'plataforma',
  'administracao',
  // Semente da demonstração.
  'dom-navalha',
  'corte-certo',
  'barbearia-vintage',
  'clinica-sorriso-leve',
  'barbearia-jr',
  'barbeiro-bastiao',
];

const RESERVADOS: ReadonlySet<string> = new Set(RESERVED_SLUGS);

export function isReservedSlug(slug: string): boolean {
  return RESERVADOS.has(slug.trim().toLowerCase());
}

export const SLUG_RESERVADO = 'SLUG_RESERVADO';
export const SLUG_RESERVADO_MESSAGE = 'Este endereço é reservado pelo Agenda Cloud. Escolha outro.';

/** Contrato para uma futura troca de slug (hoje nenhuma rota troca): mudar
 * PARA um slug reservado é 409 `SLUG_RESERVADO`; reenviar o slug atual sem
 * mudança passa, mesmo que ele seja reservado (cadastro antigo). */
export function assertSlugChangeAllowed(currentSlug: string, requestedSlug: string): void {
  if (currentSlug.trim().toLowerCase() === requestedSlug.trim().toLowerCase()) return;
  if (isReservedSlug(requestedSlug)) {
    throw new ConflictException({ code: SLUG_RESERVADO, message: SLUG_RESERVADO_MESSAGE });
  }
}
