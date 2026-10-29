// Confere o modelo do workflow operacional do backup (lote O1) e o workflow de
// teste deste repositório, só lendo os arquivos. O modelo nunca roda aqui:
// ele vive em docs/runbooks/modelos/ e só vira workflow no repositório
// privado de operação.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkYamlSanity } from './lib/yaml-sanity-check.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modelo = readFileSync(path.join(raiz, 'docs/runbooks/modelos/backup-piloto.yml'), 'utf-8');
const teste = readFileSync(path.join(raiz, '.github/workflows/test-backup-agendado.yml'), 'utf-8');
const usos = (texto: string) => [...texto.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]);

describe('modelo do workflow operacional (docs/runbooks/modelos/backup-piloto.yml)', () => {
  it('passa na checagem sintática leve de YAML', () => {
    expect(checkYamlSanity(modelo).errors).toEqual([]);
  });

  it('não está entre os workflows ativos do repositório público', () => {
    const ativos = readdirSync(path.join(raiz, '.github/workflows'));
    expect(ativos.some((nome) => readFileSync(path.join(raiz, '.github/workflows', nome), 'utf-8').includes('backup-agendado.mjs'))).toBe(false);
    expect(existsSync(path.join(raiz, '.github/workflows/backup-piloto.yml'))).toBe(false);
  });

  it('só roda no repositório privado de operação, por agendamento ou à mão', () => {
    expect(modelo).toMatch(/^\s*if: github\.repository == 'Welington753\/agenda-cloud-operacao'$/m);
    expect(modelo).toMatch(/^\s*schedule:/m);
    expect(modelo).toMatch(/^\s*workflow_dispatch:/m);
    expect(modelo).not.toMatch(/^\s*(push|pull_request|pull_request_target):/m);
    expect(modelo).toContain('BACKUP_MODO: piloto');
  });

  it('permissões mínimas, sem concorrência entre execuções', () => {
    expect(modelo).toMatch(/^permissions:\s*\n\s+contents: read\s*\n\s*\njobs:/m);
    expect(modelo).toMatch(/cancel-in-progress: false/);
  });

  it('nada vai para artifact ou cache', () => {
    for (const proibido of ['upload-artifact', 'actions/cache', 'cache:', 'save-always']) expect(modelo).not.toContain(proibido);
  });

  it('actions fixadas por SHA e o código do Agenda-Cloud num commit fixo, sem credencial persistida', () => {
    for (const uso of usos(modelo)) expect(uso).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(modelo).toContain('repository: Welington753/Agenda-Cloud');
    expect(modelo).toContain('ref: ${{ env.CODIGO_SHA }}');
    expect(modelo).toContain('persist-credentials: false');
  });

  it('segredos só por secrets; chave pública e IDs por vars; nenhuma chave privada', () => {
    for (const nome of ['PILOTO_BACKUP_URL', 'B2_KEY_ID', 'B2_APP_KEY', 'SENTRY_CRON_URL']) expect(modelo).toContain(`${nome}: \${{ secrets.${nome} }}`);
    for (const nome of ['AGE_RECIPIENT', 'B2_BUCKET', 'B2_ENDPOINT', 'PILOT_ENDPOINT_ID', 'PRODUCTION_ENDPOINT_ID']) expect(modelo).toContain(`${nome}: \${{ vars.${nome} }}`);
    expect(modelo).not.toMatch(/AGE-SECRET-KEY|age-keygen|-i\s+\S+\.key|postgres(?:ql)?:\/\/[^$]*neon/i);
  });

  it('a restauração usa o descartável local com senha aleatória mascarada', () => {
    expect(modelo).toContain('-p 127.0.0.1:55433:5432');
    expect(modelo).toContain('::add-mask::');
    expect(modelo).toContain('sslmode=verify-full');
  });
});

describe('.github/workflows/test-backup-agendado.yml', () => {
  it('passa na checagem sintática leve de YAML', () => {
    expect(checkYamlSanity(teste).errors).toEqual([]);
  });

  it('só PR para a integration ou à mão; sem secrets; actions por SHA', () => {
    expect(teste).toMatch(/pull_request:\s*\n\s+branches:\s*\n\s+- integration\/nestjs-typeorm-frontend/);
    expect(teste).not.toMatch(/secrets\.|schedule:|environment:/);
    for (const uso of usos(teste)) expect(uso).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('exige as ferramentas reais (sem age simulado) e não sobe artifact', () => {
    expect(teste).toContain('BACKUP_E2E_EXIGIR_FERRAMENTAS: "true"');
    expect(teste).not.toContain('BACKUP_E2E_AGE_SIMULADO');
    expect(teste).not.toContain('upload-artifact');
  });
});
