// O manifesto (required-migrations.ts) precisa ser EXATAMENTE o que o
// DataSource de migrations carrega: uma migration carregável fora dele
// deixaria a conferência de inicialização aprovar um banco que não a tem.
//
// O QUE O DATASOURCE CARREGA (migrations-data-source.ts, único DataSource de
// migrations; o runtime usa `migrations: []`): o glob
// `migrations/**/!(*.spec).{ts,js}`. Ou seja, QUALQUER `.ts`/`.js` que não
// seja spec, em qualquer subpasta e com qualquer nome. O runtime compilado
// (`dist-migrations`, tsconfig.migrations.json) inclui `src/migrations/**/*.ts`
// menos os specs: o mesmo conjunto.
//
// Por isso a conferência parte desse conjunto, não da convenção de nome. Um
// arquivo carregável fora da convenção `<13 dígitos>-<Nome>.ts`, ou dentro de
// uma subpasta, REPROVA: nunca é ignorado em silêncio (era a brecha da versão
// anterior deste teste, demonstrada nas regressões abaixo).
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMigrationsDataSourceOptions } from './migrations-data-source.js';
import { REQUIRED_MIGRATIONS } from './required-migrations.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Glob do DataSource de migrations, relativo ao diretório de migrations. A
 * regra de `arquivosCarregaveis` espelha este glob; se ele mudar, o teste
 * "o glob do DataSource é o que esta conferência espelha" reprova. */
const GLOB_DO_DATASOURCE = '**/!(*.spec).{ts,js}';

/** Convenção do projeto: `1793664000000-TenantTestFlag.ts`, direto no
 * diretório de migrations. */
const CONVENCAO = /^(\d{13})-([A-Za-z0-9]+)\.ts$/;

/** Todo arquivo que o glob do DataSource carregaria, em caminho relativo com
 * `/`: `.ts` ou `.js`, em qualquer profundidade, cujo nome sem a extensão não
 * termine em `.spec`. */
function arquivosCarregaveis(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile())
    .map((entrada) => path.relative(dir, path.join(entrada.parentPath, entrada.name)).replaceAll('\\', '/'))
    .filter((relativo) => {
      const partes = /^(.*)\.(ts|js)$/.exec(path.posix.basename(relativo));
      return partes !== null && !partes[1].endsWith('.spec');
    })
    .sort();
}

interface Conferencia {
  /** Nomes que o TypeORM grava (`TenantTestFlag1793664000000`), na ordem de
   * aplicação, dos arquivos dentro da convenção. */
  nomes: string[];
  /** Carregáveis fora da convenção (nome ou subpasta). Sempre reprovam. */
  foraDaConvencao: string[];
}

function conferirDiretorio(dir: string): Conferencia {
  const dentro: RegExpExecArray[] = [];
  const foraDaConvencao: string[] = [];
  for (const relativo of arquivosCarregaveis(dir)) {
    const partes = CONVENCAO.exec(relativo);
    if (partes) dentro.push(partes);
    else foraDaConvencao.push(relativo);
  }
  return {
    nomes: dentro.sort((a, b) => Number(a[1]) - Number(b[1])).map(([, carimbo, nome]) => `${nome}${carimbo}`),
    foraDaConvencao,
  };
}

/** Lista vazia: o manifesto cobre tudo o que o diretório faz carregar. */
function problemasDoManifesto(manifesto: readonly string[], dir: string): string[] {
  const { nomes, foraDaConvencao } = conferirDiretorio(dir);
  const noManifesto = new Set(manifesto);
  const noDiretorio = new Set(nomes);
  return [
    ...foraDaConvencao.map((arquivo) => `arquivo carregável fora da convenção: ${arquivo}`),
    ...nomes.filter((nome) => !noManifesto.has(nome)).map((nome) => `migration fora do manifesto: ${nome}`),
    ...manifesto.filter((nome) => !noDiretorio.has(nome)).map((nome) => `nome do manifesto sem arquivo: ${nome}`),
  ];
}

/** A regra da versão anterior deste teste, mantida só para as regressões
 * mostrarem a brecha: lia um nível e DESCARTAVA o que não casava. */
function nomesPelaRegraAntiga(dir: string): string[] {
  return readdirSync(dir)
    .map((arquivo) => CONVENCAO.exec(arquivo))
    .filter((partes): partes is RegExpExecArray => partes !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(([, carimbo, nome]) => `${nome}${carimbo}`);
}

describe('manifesto das migrations exigidas', () => {
  it('o glob do DataSource é o que esta conferência espelha', () => {
    const opcoes = buildMigrationsDataSourceOptions('postgresql://ficticio@localhost:5432/ficticio');
    expect(opcoes.migrations).toEqual([path.join(migrationsDir, GLOB_DO_DATASOURCE)]);
  });

  it('todo arquivo carregável do diretório segue a convenção (nenhum fora dela, nenhuma subpasta)', () => {
    expect(conferirDiretorio(migrationsDir).foraDaConvencao).toEqual([]);
  });

  it('lista todas as migrations carregáveis, na ordem de aplicação, e nenhuma a mais', () => {
    expect(REQUIRED_MIGRATIONS).toEqual(conferirDiretorio(migrationsDir).nomes);
    expect(problemasDoManifesto(REQUIRED_MIGRATIONS, migrationsDir)).toEqual([]);
  });

  it('o diretório foi lido de verdade (não compara duas listas vazias)', () => {
    expect(arquivosCarregaveis(migrationsDir).length).toBeGreaterThanOrEqual(18);
    expect(REQUIRED_MIGRATIONS).toContain('InitialSchema1788782400000');
    expect(REQUIRED_MIGRATIONS).toContain('TenantTestFlag1793664000000');
  });

  it('não repete nome e todo nome termina no carimbo de 13 dígitos', () => {
    expect(new Set(REQUIRED_MIGRATIONS).size).toBe(REQUIRED_MIGRATIONS.length);
    for (const nome of REQUIRED_MIGRATIONS) expect(nome).toMatch(/^[A-Za-z0-9]+\d{13}$/);
  });
});

// Regressões em diretório TEMPORÁRIO (pasta temporária do sistema, apagada no
// fim): nenhuma migration fictícia entra no produto.
describe('conferência do diretório: migration carregável nunca passa despercebida', () => {
  const MANIFESTO = ['Primeira1700000000001', 'Segunda1700000000002'];
  const temporarios: string[] = [];

  /** Diretório com as duas migrations do manifesto, um spec ao lado (que o
   * glob não carrega) e os arquivos extras pedidos. */
  function diretorioCom(extras: string[] = []): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'manifesto-migrations-'));
    temporarios.push(dir);
    const arquivos = [
      '1700000000001-Primeira.ts',
      '1700000000002-Segunda.ts',
      '1700000000002-Segunda.spec.ts',
      'estrutura-geral.spec.ts',
      ...extras,
    ];
    for (const relativo of arquivos) {
      const destino = path.join(dir, relativo);
      mkdirSync(path.dirname(destino), { recursive: true });
      writeFileSync(destino, '// arquivo de teste, sem conteúdo\n');
    }
    return dir;
  }

  afterEach(() => {
    for (const dir of temporarios.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('diretório igual ao manifesto: nenhum problema, e specs não contam', () => {
    const dir = diretorioCom();
    expect(arquivosCarregaveis(dir)).toEqual(['1700000000001-Primeira.ts', '1700000000002-Segunda.ts']);
    expect(problemasDoManifesto(MANIFESTO, dir)).toEqual([]);
  });

  it('migration nova dentro da convenção, esquecida no manifesto: reprova pelo nome', () => {
    const dir = diretorioCom(['1700000000003-Terceira.ts']);
    expect(problemasDoManifesto(MANIFESTO, dir)).toEqual(['migration fora do manifesto: Terceira1700000000003']);
  });

  it('nome do manifesto sem arquivo no diretório: reprova', () => {
    const dir = diretorioCom();
    expect(problemasDoManifesto([...MANIFESTO, 'Fantasma1700000000009'], dir)).toEqual([
      'nome do manifesto sem arquivo: Fantasma1700000000009',
    ]);
  });

  // Cada caso abaixo é um arquivo que o glob do DataSource CARREGA e que a
  // regra antiga descartava: com ela, o manifesto de duas migrations seguia
  // "igual ao diretório" e o teste passava.
  it.each([
    ['nome com hífen', '1700000000003-terceira-esquecida.ts'],
    ['nome com sublinhado', '1700000000003-Terceira_Esquecida.ts'],
    ['carimbo fora dos 13 dígitos', '1700000003-Terceira.ts'],
    ['sem carimbo', 'Terceira.ts'],
    ['subpasta, com nome dentro da convenção', 'lote/1700000000003-Terceira.ts'],
    ['subpasta mais funda', 'lote/parte/1700000000003-Terceira.ts'],
    ['JavaScript ao lado das migrations', '1700000000003-Terceira.js'],
    ['spec só no meio do nome', '1700000000003-Terceira.spec.extra.ts'],
  ])('brecha anterior, %s: a regra antiga não via; a conferência reprova', (_caso, arquivo) => {
    const dir = diretorioCom([arquivo]);

    // A brecha: a regra antiga devolve o próprio manifesto, como se nada
    // tivesse sido acrescentado.
    expect(nomesPelaRegraAntiga(dir)).toEqual(MANIFESTO);

    // A correção: o arquivo é carregável e aparece como problema.
    expect(arquivosCarregaveis(dir)).toContain(arquivo);
    expect(problemasDoManifesto(MANIFESTO, dir)).toEqual([`arquivo carregável fora da convenção: ${arquivo}`]);
  });

  it('arquivos que o glob não carrega não reprovam (spec em subpasta, outra extensão)', () => {
    const dir = diretorioCom(['lote/1700000000003-Terceira.spec.ts', 'LEIA-ME.md', 'dados.json']);
    expect(problemasDoManifesto(MANIFESTO, dir)).toEqual([]);
  });
});
