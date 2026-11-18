import { describe, expect, it } from 'vitest';
import {
  deltaDoTipo,
  estoqueBaixo,
  quantidadeValidaNaUnidade,
  tipoCombinaComFinalidade,
} from './stock-quantity.js';

describe('quantidades do estoque (milésimos)', () => {
  it('unidades de contagem e G/ML só aceitam inteiros; KG e L até 3 casas', () => {
    for (const unit of ['UN', 'CX', 'PCT', 'FR', 'G', 'ML'] as const) {
      expect(quantidadeValidaNaUnidade(2000, unit), unit).toBe(true);
      expect(quantidadeValidaNaUnidade(1500, unit), unit).toBe(false);
      expect(quantidadeValidaNaUnidade(1, unit), unit).toBe(false);
    }
    for (const unit of ['KG', 'L'] as const) {
      expect(quantidadeValidaNaUnidade(1500, unit), unit).toBe(true);
      expect(quantidadeValidaNaUnidade(1, unit), unit).toBe(true);
    }
    expect(quantidadeValidaNaUnidade(1.5, 'KG')).toBe(false);
    expect(quantidadeValidaNaUnidade(Number.MAX_SAFE_INTEGER + 2, 'KG')).toBe(false);
  });

  it('entrada soma, saídas tiram', () => {
    expect(deltaDoTipo('ENTRADA_COMPRA', 3000)).toBe(3000);
    expect(deltaDoTipo('SAIDA_VENDA', 3000)).toBe(-3000);
    expect(deltaDoTipo('SAIDA_CONSUMO', 3000)).toBe(-3000);
    expect(deltaDoTipo('SAIDA_PERDA', 3000)).toBe(-3000);
  });

  it('saída por venda só de produto de venda; por consumo, só de consumo interno', () => {
    expect(tipoCombinaComFinalidade('SAIDA_VENDA', 'VENDA')).toBe(true);
    expect(tipoCombinaComFinalidade('SAIDA_VENDA', 'AMBOS')).toBe(true);
    expect(tipoCombinaComFinalidade('SAIDA_VENDA', 'CONSUMO_INTERNO')).toBe(false);
    expect(tipoCombinaComFinalidade('SAIDA_CONSUMO', 'CONSUMO_INTERNO')).toBe(true);
    expect(tipoCombinaComFinalidade('SAIDA_CONSUMO', 'VENDA')).toBe(false);
    expect(tipoCombinaComFinalidade('SAIDA_PERDA', 'VENDA')).toBe(true);
    expect(tipoCombinaComFinalidade('ENTRADA_COMPRA', 'CONSUMO_INTERNO')).toBe(true);
  });

  it('estoque baixo: no mínimo ou abaixo, só com mínimo definido', () => {
    expect(estoqueBaixo(5000, 5000)).toBe(true);
    expect(estoqueBaixo(4000, 5000)).toBe(true);
    expect(estoqueBaixo(6000, 5000)).toBe(false);
    expect(estoqueBaixo(0, 0)).toBe(false);
  });
});
