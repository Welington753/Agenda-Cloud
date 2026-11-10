import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { resolveSlug, slugify } from '../auth/slug.js';
import { RESERVED_SLUGS, SLUG_RESERVADO, assertSlugChangeAllowed, isReservedSlug } from './reserved-slugs.js';

const livre = async () => false;

describe('RESERVED_SLUGS', () => {
  it('cada valor já está na forma de slugify, sem repetição', () => {
    for (const slug of RESERVED_SLUGS) expect(slugify(slug)).toBe(slug);
    expect(new Set(RESERVED_SLUGS).size).toBe(RESERVED_SLUGS.length);
  });

  it('não reserva nomes de pastas dinâmicas nem grupos de rotas', () => {
    expect(RESERVED_SLUGS.some((s) => /slug|area|\[|\(/.test(s))).toBe(false);
  });
});

describe('isReservedSlug', () => {
  it('rotas da raiz, entradas antigas e semente da demonstração', () => {
    for (const slug of ['portal', 'login', 'conta', 'agendar', '403', 'plataforma', 'dom-navalha', 'barbeiro-bastiao']) {
      expect(isReservedSlug(slug)).toBe(true);
    }
  });

  it('sem diferença de maiúsculas nem espaços nas pontas, como a coluna citext', () => {
    expect(isReservedSlug('Portal')).toBe(true);
    expect(isReservedSlug(' LOGIN ')).toBe(true);
  });

  it('nome de negócio comum e variações com sufixo ficam livres', () => {
    for (const slug of ['barbearia-do-ze', 'portal-2', 'portalzinho', 'login-barbearia', 'dom-navalha-2']) {
      expect(isReservedSlug(slug)).toBe(false);
    }
  });
});

describe('cadastro com nome que gera slug reservado', () => {
  it('a mesma normalização do cadastro chega no reservado e recebe sufixo', async () => {
    expect(await resolveSlug(slugify('Portal'), livre)).toBe('portal-2');
    expect(await resolveSlug(slugify('  LOGIN!! '), livre)).toBe('login-2');
    expect(await resolveSlug(slugify('Dom Navalha'), livre)).toBe('dom-navalha-2');
    expect(await resolveSlug(slugify('Redefinir Senha'), livre)).toBe('redefinir-senha-2');
  });

  it('reservado e ocupado no banco: segue para o próximo livre', async () => {
    const ocupados = new Set(['portal-2']);
    expect(await resolveSlug('portal', async (c) => ocupados.has(c))).toBe('portal-3');
  });

  it('nome livre não muda', async () => {
    expect(await resolveSlug(slugify('Barbearia do Zé'), livre)).toBe('barbearia-do-ze');
  });

  it('o banco nem é consultado para o slug reservado', async () => {
    const consultados: string[] = [];
    await resolveSlug('conta', async (c) => {
      consultados.push(c);
      return false;
    });
    expect(consultados).toEqual(['conta-2']);
  });
});

describe('assertSlugChangeAllowed (contrato da troca de slug)', () => {
  it('mudar para reservado: 409 com code SLUG_RESERVADO', () => {
    try {
      assertSlugChangeAllowed('barbearia-do-ze', 'Portal');
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(ConflictException);
      expect((erro as ConflictException).getStatus()).toBe(409);
      expect((erro as ConflictException).getResponse()).toMatchObject({ code: SLUG_RESERVADO });
    }
  });

  it('cadastro antigo com slug reservado reenviando o mesmo slug: passa', () => {
    expect(() => assertSlugChangeAllowed('portal', 'portal')).not.toThrow();
    expect(() => assertSlugChangeAllowed('portal', 'PORTAL')).not.toThrow();
  });

  it('mudar para slug livre: passa (a unicidade fica com a UNIQUE do banco)', () => {
    expect(() => assertSlugChangeAllowed('portal', 'barbearia-nova')).not.toThrow();
  });
});
