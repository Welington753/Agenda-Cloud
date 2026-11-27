// Comparação geral de acessos, antes e depois da refatoração da etapa 1
// (docs/plans/permissoes-individuais.md, seção 5.4). Complementa os specs de
// equivalência de cada área, que comparam cada política com a regra literal:
// aqui as áreas são comparadas juntas, com a referência sendo a cópia byte a
// byte do código do piloto (`legacy/`), e o inventário reprova política,
// constante ou consumidor novo que fique fora da comparação.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EstablishmentRole } from '../../src/entities/enums/establishment-role.enum.js';
import {
  ACOES,
  MODULOS_COMPARADOS,
  accessFingerprint,
  casosSorteados,
  gruposDeCasos,
  implementacaoAntes,
  implementacaoDepois,
  type Cenario,
  type Implementacao,
  type ModuloComparado,
} from './access-fingerprint.js';
import { LEGACY_MANIFEST } from './legacy-manifest.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(AQUI, '../../src');
const SEMENTE = 20261127;
const SORTEADOS = 4000;

/** Primeira diferença entre as impressões, para a mensagem de erro. */
function diferenca(antes: readonly string[], depois: readonly string[]): string | null {
  const a = new Set(antes);
  const d = new Set(depois);
  const so = (x: Set<string>, y: Set<string>) => [...x].filter((p) => !y.has(p));
  const faltam = so(a, d);
  const sobram = so(d, a);
  if (!faltam.length && !sobram.length) return null;
  return `antes, sem igual depois: ${faltam.slice(0, 3).join(' | ')}\ndepois, sem igual antes: ${sobram.slice(0, 3).join(' | ')}`;
}

async function compararTodos(depois: Implementacao, casos: Iterable<Cenario>): Promise<{ total: number; diferentes: string[] }> {
  const antes = implementacaoAntes();
  const diferentes: string[] = [];
  let total = 0;
  for (const caso of casos) {
    total++;
    const d = diferenca(await accessFingerprint(antes, caso), await accessFingerprint(depois, caso));
    if (d) diferentes.push(`${caso.rotulo}\n${d}`);
  }
  return { total, diferentes };
}

function* soCasos(): Generator<Cenario> {
  for (const { caso } of gruposDeCasos()) yield caso;
}

// ------------------------------------------------------------- inventário

describe('impressão geral: a referência congelada e o inventário', () => {
  it('as cópias de legacy/ são byte a byte as do piloto (8f71335)', () => {
    const conferidos = Object.entries(LEGACY_MANIFEST).map(([arquivo, hash]) => {
      const texto = readFileSync(path.join(AQUI, 'legacy', arquivo), 'utf8').replace(/\r\n/g, '\n');
      return [arquivo, createHash('sha256').update(texto).digest('hex') === hash] as const;
    });
    expect(conferidos.filter(([, ok]) => !ok)).toEqual([]);
    expect(conferidos.length).toBe(14);
  });

  it('todo arquivo *-access.ts de src/ está na comparação ou fora dela com motivo', () => {
    const FORA: Readonly<Record<string, string>> = {
      'auth/tenant-access.ts': 'situação do estabelecimento (isTenantUsableForSession): sem mudança, testes com banco',
      'platform/platform-access.ts': 'administração da plataforma, não vínculo de estabelecimento',
      'professionals/professional-tenant-access.ts':
        'prova do vínculo para Profissionais; a política dela (canView/ManageProfessionals) está em ACOES',
    };
    const achados: string[] = [];
    const andar = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) andar(p);
        else if (e.name.endsWith('-access.ts')) achados.push(path.relative(SRC, p).split(path.sep).join('/'));
      }
    };
    andar(SRC);
    const registrados = new Set<string>([...MODULOS_COMPARADOS, ...Object.keys(FORA)]);
    expect(achados.filter((a) => !registrados.has(a)).sort()).toEqual([]);
    expect([...registrados].filter((r) => r !== 'common/manager-permissions.ts' && !achados.includes(r))).toEqual([]);
  });

  it('toda função exportada das políticas atuais entra na impressão (ou tem motivo)', async () => {
    const depois = implementacaoDepois();
    const antes = implementacaoAntes();
    for (const caso of casosSorteados(SEMENTE, 50)) {
      await accessFingerprint(depois, caso);
      await accessFingerprint(antes, caso);
    }
    /** Usadas pelas superfícies compostas (recorte, histórico, sessão), não pelo nome. */
    const POR_SUPERFICIE: Readonly<Record<string, string>> = {
      'appointments/appointment-access.ts#canSeeAppointmentContact': 'campos.agenda (recortarParaQuemPediu)',
      'appointments/appointment-access.ts#canSeeAppointmentPrices': 'campos.agenda e campos.historico',
      'availability/availability-access.ts#canSeeAvailabilityPrices': 'campos.disponibilidade (precosParaQuemPediu)',
      'common/manager-permissions.ts#managerCan': 'base das políticas de gerente; todas as ações',
      'common/manager-permissions.ts#managerGranted': 'base das políticas de gerente; todas as ações',
      'common/manager-permissions.ts#managerGrantedPermissions': 'equipe.efetivas',
      'common/manager-permissions.ts#receptionistCan': 'base das políticas da recepcionista; vendas',
      'common/manager-permissions.ts#receptionistGranted': 'base das políticas da recepcionista; vendas',
      'common/manager-permissions.ts#receptionistGrantedPermissions': 'equipe.efetivas',
      'common/manager-permissions.ts#missingManagerRequirements': 'validarConcessoes (o que cada papel recebe), sem mudança',
      'common/manager-permissions.ts#isManagerPermission': 'catálogo; validarConcessoes',
      'common/manager-permissions.ts#isReceptionistPermission': 'catálogo; validarConcessoes',
    };
    const faltam: string[] = [];
    for (const modulo of MODULOS_COMPARADOS) {
      for (const [nome, valor] of Object.entries(depois.modulos[modulo])) {
        if (typeof valor !== 'function') continue;
        const chave = `${modulo}#${nome}`;
        if (!depois.usadas.has(chave) && !POR_SUPERFICIE[chave]) faltam.push(chave);
      }
    }
    expect(faltam).toEqual([]);
    // As demais são consultadas pelo mesmo nome nos dois lados. Estas duas só
    // no espelho atual de resolveStaffAccess; no antes, o trecho copiado de
    // my-agenda.service.ts as chama diretamente (servicos-recortes.ts).
    expect([...depois.usadas].filter((u) => !antes.usadas.has(u)).sort()).toEqual([
      'commissions/commission-access.ts#canViewOwnCommissions',
      'team/staff-access.ts#staffPermissionGranted',
    ]);
  });

  it('constantes exportadas (mensagens do 403, catálogos, áreas, recursos) iguais às do piloto', () => {
    const depois = implementacaoDepois();
    const antes = implementacaoAntes();
    const diferentes: string[] = [];
    const novas: string[] = [];
    for (const modulo of MODULOS_COMPARADOS) {
      for (const [nome, valor] of Object.entries(depois.modulos[modulo])) {
        if (typeof valor === 'function') continue;
        if (!(nome in antes.modulos[modulo])) {
          novas.push(`${modulo}#${nome}`);
          continue;
        }
        if (JSON.stringify(valor) !== JSON.stringify(antes.modulos[modulo][nome])) diferentes.push(`${modulo}#${nome}`);
      }
      for (const nome of Object.keys(antes.modulos[modulo])) {
        if (!(nome in depois.modulos[modulo])) diferentes.push(`${modulo}#${nome} (sumiu)`);
      }
    }
    expect(diferentes).toEqual([]);
    expect(novas).toEqual([]);
  });

  it('os consumidores das políticas em src/ são os registrados', () => {
    const esperado = JSON.parse(readFileSync(path.join(AQUI, 'consumidores-das-politicas.json'), 'utf8')) as Record<
      string,
      string[]
    >;
    expect(consumidoresDasPoliticas()).toEqual(esperado);
  });
});

/** Arquivo de src/ (fora de spec) e as funções que ele importa de um
 * `*-access.ts` ou da base comum. Um consumidor novo, ou uma política nova
 * num consumidor, precisa entrar na impressão (ACOES ou uma superfície) e
 * neste registro, dizendo que ajustes a rota passa (`valem`, `gravados` ou
 * `negadas`). */
function consumidoresDasPoliticas(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const re = /(?:import|export)\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']*(?:-access|access-evaluation)\.js)'/g;
  const andar = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        andar(p);
        continue;
      }
      if (!p.endsWith('.ts') || p.endsWith('.spec.ts')) continue;
      const texto = readFileSync(p, 'utf8');
      const relDir = path.relative(SRC, path.dirname(p)).split(path.sep).join('/');
      const nomes: string[] = [];
      for (const m of texto.matchAll(re)) {
        const mod = path.posix.normalize(path.posix.join(relDir, m[2])).replace(/\.js$/, '.ts');
        for (const item of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          if (item.startsWith('type ')) continue;
          const nome = item.split(/\s+as\s+/)[0].trim();
          if (/^[A-Z_]+$/.test(nome)) continue;
          nomes.push(`${mod}#${nome}`);
        }
      }
      if (nomes.length) out[path.relative(SRC, p).split(path.sep).join('/')] = [...new Set(nomes)].sort();
    }
  };
  andar(SRC);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

// ------------------------------------------------------------- comparação

describe('impressão geral: antes e depois iguais em todas as superfícies', () => {
  it('os grupos de casos (papéis, confirmação, profissional, ajustes e recursos)', async () => {
    const porGrupo = new Map<string, number>();
    const casos: Cenario[] = [];
    for (const { grupo, caso } of gruposDeCasos()) {
      porGrupo.set(grupo, (porGrupo.get(grupo) ?? 0) + 1);
      casos.push(caso);
    }
    const { total, diferentes } = await compararTodos(implementacaoDepois(), casos);
    expect(diferentes.slice(0, 5)).toEqual([]);
    expect(Object.fromEntries(porGrupo)).toMatchObject({
      recursos: expect.any(Number),
      'cada permissão': expect.any(Number),
      'dependência negada': expect.any(Number),
      'dependência ausente': expect.any(Number),
      'ignoradas e plano': expect.any(Number),
      pares: expect.any(Number),
    });
    expect(total).toBe(8256);
  }, 120_000);

  it(`${SORTEADOS} casos sorteados com semente fixa (${SEMENTE})`, async () => {
    const { total, diferentes } = await compararTodos(implementacaoDepois(), casosSorteados(SEMENTE, SORTEADOS));
    expect(diferentes.slice(0, 5)).toEqual([]);
    expect(total).toBe(SORTEADOS);
  }, 120_000);

  it('cada par muda de valor em algum caso (nenhuma superfície constante por engano)', async () => {
    const valores = new Map<string, Set<string>>();
    const depois = implementacaoDepois();
    for (const caso of [...soCasos()].filter((_, i) => i % 7 === 0)) {
      for (const par of await accessFingerprint(depois, caso)) {
        const i = par.indexOf('=');
        const chave = par.slice(0, i);
        if (!valores.has(chave)) valores.set(chave, new Set());
        valores.get(chave)!.add(par.slice(i + 1));
      }
    }
    const constantes = [...valores].filter(([, v]) => v.size < 2).map(([k]) => k);
    expect(constantes).toEqual([]);
    for (const acao of ACOES) expect(valores.has(acao.chave)).toBe(true);
  }, 120_000);

  it('todas as áreas da sessão aparecem em algum caso, antes e depois', async () => {
    const vistas = { antes: new Set<string>(), depois: new Set<string>() };
    const impls = { antes: implementacaoAntes(), depois: implementacaoDepois() };
    for (const caso of [...soCasos()].filter((_, i) => i % 11 === 0)) {
      for (const lado of ['antes', 'depois'] as const) {
        const sessao = (await accessFingerprint(impls[lado], caso)).find((p) => p.startsWith('sessao='))!;
        for (const area of sessao.slice('sessao='.length).split(',').filter(Boolean)) vistas[lado].add(area);
      }
    }
    const areas = (impls.depois.modulos['accounts/tenant-effective-access.ts'].TENANT_AREAS as { key: string }[]).map((a) => a.key);
    expect(areas.filter((a) => !vistas.depois.has(a))).toEqual([]);
    expect([...vistas.depois].sort()).toEqual([...vistas.antes].sort());
  }, 120_000);
});

// ---------------------------------------------------------------- mutantes

/** Implementação "depois" com uma função trocada, para provar que a
 * comparação apanha a mudança. */
function mutante(troca: (impl: Implementacao) => void): Implementacao {
  const impl = implementacaoDepois();
  impl.modulos = Object.fromEntries(Object.entries(impl.modulos).map(([k, v]) => [k, { ...v }])) as Record<
    ModuloComparado,
    Record<string, unknown>
  >;
  troca(impl);
  return impl;
}

const trocar = (impl: Implementacao, modulo: ModuloComparado, nome: string, nova: (...a: any[]) => unknown) => {
  (impl.modulos[modulo] as Record<string, unknown>)[nome] = nova;
};
const original = (impl: Implementacao, modulo: ModuloComparado, nome: string) =>
  impl.modulos[modulo][nome] as (...a: any[]) => any;

describe('impressão geral: mutantes apanhados', () => {
  const MUTANTES: Record<string, (impl: Implementacao) => void> = {
    'dono vê a agenda mesmo com a negada': (i) => {
      const politica = original(i, 'appointments/appointment-access.ts', 'canViewAppointments');
      trocar(i, 'appointments/appointment-access.ts', 'canViewAppointments', (r, o) =>
        r === EstablishmentRole.DONO ? true : politica(r, o),
      );
    },
    'serviços passam a aplicar a confirmação (a correção pendente não entra aqui)': (i) => {
      const politica = original(i, 'services/service-access.ts', 'canViewServices');
      trocar(i, 'services/service-access.ts', 'canViewServices', (r, o) =>
        politica(r, r === EstablishmentRole.GERENTE ? [] : o),
      );
    },
    'receber venda de outra pessoa sem a consulta geral': (i) => {
      const politica = original(i, 'sales/sales-access.ts', 'canReceiveSale');
      trocar(i, 'sales/sales-access.ts', 'canReceiveSale', (r, o) => politica(r, o, { ownSale: true }));
    },
    'recepcionista com estoque concedido': (i) => {
      const politica = original(i, 'stock/stock-access.ts', 'canViewStock');
      trocar(i, 'stock/stock-access.ts', 'canViewStock', (r, o) =>
        r === EstablishmentRole.RECEPCIONISTA ? o.some((x: { permission: string; mode: string }) => x.permission === 'ESTOQUE_VISUALIZAR' && x.mode === 'GRANTED') : politica(r, o),
      );
    },
    'gerente não confirmado com agenda própria': (i) => {
      const politica = original(i, 'team/staff-access.ts', 'canViewOwnAgenda');
      trocar(i, 'team/staff-access.ts', 'canViewOwnAgenda', (r) => politica(r, true));
    },
    'próprias comissões sem a concessão': (i) =>
      trocar(i, 'commissions/commission-access.ts', 'canViewOwnCommissions', (r) =>
        r === EstablishmentRole.PROFISSIONAL || r === EstablishmentRole.GERENTE,
      ),
    'gerente concede o que o dono concederia': (i) => {
      const politica = original(i, 'team/staff-access.ts', 'grantableManagerPermissions');
      trocar(i, 'team/staff-access.ts', 'grantableManagerPermissions', (r, o) =>
        politica(r === EstablishmentRole.GERENTE ? EstablishmentRole.DONO : r, o),
      );
    },
    'portal sem a área de Equipe': (i) => {
      const politica = original(i, 'accounts/tenant-effective-access.ts', 'tenantEffectiveAccess');
      trocar(i, 'accounts/tenant-effective-access.ts', 'tenantEffectiveAccess', (r, o) =>
        politica(r, o).filter((a: { key: string }) => a.key !== 'EQUIPE'),
      );
    },
    'menu com a agenda própria sem profissional ligado': (i) => {
      const sessao = i.sessionAreas;
      i.sessionAreas = async (m, v) => sessao(m, { ...v, professionalId: v.professionalId ?? 'qualquer' });
    },
    'menu sem conferir os recursos': (i) => {
      const sessao = i.sessionAreas;
      i.sessionAreas = async (m, v) => {
        const tudo = { query: async (sql: string, p: unknown[]) => (sql.includes('FROM features') ? (await m.query(sql, p)).concat([{ key: 'VENDAS' }, { key: 'ESTOQUE' }]) : m.query(sql, p)) };
        return sessao(tudo as never, v);
      };
    },
    'preço da agenda visível ao gerente sem recebimentos': (i) => {
      const recorte = i.recorteDaAgenda;
      i.recorteDaAgenda = (view, quem) => {
        const r = recorte(view, quem);
        return { ...r, priceCents: view.priceCents, hidden: (r.hidden ?? []).filter((h) => h !== 'price') };
      };
    },
    'histórico mostra o recebimento sem o recurso': (i) => {
      const historico = i.historico;
      i.historico = (quem) => historico(quem, true);
    },
    'lista de Equipe sem a confirmação': (i) => {
      const efetivas = i.efetivasDaEquipe;
      i.efetivasDaEquipe = (r, _c, g) => efetivas(r, true, g);
    },
    'próprias comissões concedíveis sem o recurso': (i) => {
      const conc = i.concessiveis;
      i.concessiveis = (r, o, ligado) => conc(r, o, (x) => x === 'COMISSOES' || ligado(x));
    },
    'ação própria liberada com o profissional inativo': (i) => {
      const decisao = i.agendaPropria;
      i.agendaPropria = (linha) => decisao({ ...linha, professional_active: linha.professional_id ? true : linha.professional_active });
    },
  };

  it.each(Object.keys(MUTANTES))('%s', async (nome) => {
    const casos = [...soCasos()].filter((_, i) => i % 5 === 0).concat([...casosSorteados(SEMENTE, 500)]);
    let apanhado = false;
    const antes = implementacaoAntes();
    const depois = mutante(MUTANTES[nome]);
    for (const caso of casos) {
      if (diferenca(await accessFingerprint(antes, caso), await accessFingerprint(depois, caso))) {
        apanhado = true;
        break;
      }
    }
    expect(apanhado).toBe(true);
  }, 60_000);
});
