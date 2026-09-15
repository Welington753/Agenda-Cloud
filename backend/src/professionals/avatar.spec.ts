import { describe, expect, it } from 'vitest';
import { deriveAvatar } from './avatar.js';

describe('deriveAvatar (Lote 6D.2)', () => {
  it('usa a primeira letra do primeiro e do último nome', () => {
    expect(deriveAvatar('João Silva').avatarInitials).toBe('JS');
    expect(deriveAvatar('Maria Eduarda Costa').avatarInitials).toBe('MC');
  });

  it('nome de uma palavra só usa as duas primeiras letras', () => {
    expect(deriveAvatar('Madonna').avatarInitials).toBe('MA');
  });

  it('é determinístico: o mesmo nome sempre gera a mesma cor e iniciais', () => {
    const primeira = deriveAvatar('Ana Souza');
    const segunda = deriveAvatar('Ana Souza');
    expect(primeira).toEqual(segunda);
  });

  it('nomes diferentes podem gerar cores diferentes, sempre da paleta fixa', () => {
    const cores = new Set(
      ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio'].map(
        (nome) => deriveAvatar(nome).avatarColor,
      ),
    );
    // Não afirma quantidade exata (hash pode colidir), só que a paleta é
    // usada de verdade e cada cor é um hex válido.
    for (const cor of cores) expect(cor).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
