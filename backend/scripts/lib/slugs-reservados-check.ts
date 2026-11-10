// Conferência SÓ DE LEITURA das colisões entre slugs já gravados e a lista de
// slugs reservados (ver docs/runbooks/publicacao-tenant-teste-slugs.md,
// seção "Colisões de slug"). Nunca renomeia nada: um estabelecimento antigo
// com slug reservado continua em `/agendar/<slug>`.
//
// A lista é cópia de src/common/reserved-slugs.ts (os scripts compilam com
// `rootDir: ./scripts`); slugs-reservados-check.spec.ts confere que são
// iguais.
//
// Saída: só contagem, slug e situação. Nunca nome de pessoa, e-mail,
// telefone nem id. O slug sai porque é o endereço público do
// estabelecimento (já divulgado pelo próprio estabelecimento).
import { assertPilotConnection } from './pilot-database-check.js';
import type { PgClientLike } from './pg-client.js';
import { toSanitizedFailure, type SanitizedErrorCode } from './sanitize.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';

export const SLUGS_RESERVADOS: readonly string[] = [
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
  'plataforma',
  'administracao',
  'dom-navalha',
  'corte-certo',
  'barbearia-vintage',
  'clinica-sorriso-leve',
  'barbearia-jr',
  'barbeiro-bastiao',
];

export interface ColisaoDeSlug {
  slug: string;
  status: string;
}

export interface RelatorioDeColisoes {
  estabelecimentos: number;
  colisoes: ColisaoDeSlug[];
}

export async function lerColisoesDeSlug(client: PgClientLike): Promise<RelatorioDeColisoes> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const [total] = (await client.query<{ total: string }>('SELECT count(*)::text AS total FROM tenants')).rows;
    // `citext` compara sem diferença de maiúsculas; `lower` deixa explícito.
    const colisoes = await client.query<ColisaoDeSlug>(
      `SELECT lower(slug::text) AS slug, status::text AS status
         FROM tenants WHERE lower(slug::text) = ANY($1::text[])
        ORDER BY lower(slug::text)`,
      [[...SLUGS_RESERVADOS]],
    );
    return {
      estabelecimentos: parseNonNegativeInteger(total?.total, 'tenants'),
      colisoes: colisoes.rows.map((r) => ({ slug: r.slug, status: r.status })),
    };
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {
      // O erro original é o que importa.
    }
  }
}

export function descreverColisoes(relatorio: RelatorioDeColisoes): string[] {
  return [
    `ESTABELECIMENTOS: ${relatorio.estabelecimentos}`,
    `SLUGS_RESERVADOS: ${SLUGS_RESERVADOS.length}`,
    `COLISOES: ${relatorio.colisoes.length}`,
    ...relatorio.colisoes.map((c) => `COLISAO: ${c.slug} (situacao=${c.status}; continua em /agendar/${c.slug})`),
    'COLISOES_NOTA: nada foi renomeado; renomear é decisão caso a caso do responsável',
  ];
}

// ------------------------------------------------------------ procedimento

interface EnvLike {
  [key: string]: string | undefined;
}

export interface ColisoesCheckDeps {
  env: EnvLike;
  createClient: (connectionString: string) => Promise<PgClientLike>;
  log: (line: string) => void;
}

/** Confere o destino (o mesmo guarda do `pilot:check-database`), lê e
 * descreve. Sucesso = a leitura terminou; colisões encontradas não são falha
 * (cadastros antigos continuam valendo), só informação para o responsável. */
export async function checkReservedSlugCollisions(
  deps: ColisoesCheckDeps,
): Promise<{ success: boolean; code?: SanitizedErrorCode }> {
  let client: PgClientLike | undefined;
  try {
    const directUrl = assertPilotConnection(deps.env);
    deps.log('TARGET_ENDPOINT_MATCH: true');
    deps.log('DISTINCT_FROM_PRODUCTION: true');
    deps.log('TLS_VERIFICATION: true');
    client = await deps.createClient(directUrl);
    await client.connect();
    for (const linha of descreverColisoes(await lerColisoesDeSlug(client))) deps.log(linha);
    return { success: true };
  } catch (error) {
    const failure = toSanitizedFailure(error);
    deps.log(`ERROR: ${failure.message}`);
    return { success: false, code: failure.code };
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // Encerrar a conexão nunca muda o resultado.
      }
    }
  }
}
