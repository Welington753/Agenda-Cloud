// Regras puras da unificação: par sugerido, versão da prévia e resumo.
import { describe, expect, it } from 'vitest';
import {
  previaDe,
  previaDesatualizada,
  relacoesEntre,
  resumoDaTransferencia,
  versaoDaPrevia,
  type ConteudoDaUnificacao,
} from './consumer-merge-rules.js';

const cadastro = (whatsapp: string, nome: string, chave: string | null) => ({
  whatsapp_normalized: whatsapp,
  name_key: nome,
  phone_match_key: chave,
});

const BASE: ConteudoDaUnificacao = {
  principal: { id: 'p1', name: 'Ana', whatsapp: '11 98888-0001', email: null, unificado: false },
  secundario: { id: 's1', name: 'Ana', whatsapp: '11 98888-0001', email: null, unificado: false },
  agendamentos: [
    { id: 'a2', status: 'COMPLETED', startAt: '2026-11-01T12:00:00.000Z', precos: [5000] },
    { id: 'a1', status: 'CANCELED', startAt: '2026-10-01T12:00:00.000Z', precos: [3000, null] },
  ],
  recebimentos: [{ id: 'r1', appointmentId: 'a2', amountCents: 5000, method: 'PIX', receivedOn: '2026-11-01', refunded: false }],
  comissoes: [{ id: 'c1', appointmentId: 'a2', professionalCents: 2000, establishmentCents: 3000, status: 'CONFIRMED' }],
  pedidosPublicos: ['b1'],
};

describe('relacoesEntre', () => {
  it('mesmo telefone, número parecido e mesmo nome', () => {
    expect(relacoesEntre(cadastro('+5511988880001', 'ana', '+551188880001'), cadastro('+5511988880001', 'bia', '+551188880001'))).toEqual([
      'MESMO_TELEFONE',
    ]);
    expect(relacoesEntre(cadastro('+5511988880001', 'ana', '+551188880001'), cadastro('+551188880001', 'ana', '+551188880001'))).toEqual([
      'NUMERO_PARECIDO',
      'MESMO_NOME',
    ]);
    expect(relacoesEntre(cadastro('+5511988880001', 'ana', '+551188880001'), cadastro('+5521977770002', 'ana', '+552177770002'))).toEqual([
      'MESMO_NOME',
    ]);
  });

  it('sem relação: vazio; chave de telefone nula nunca agrupa', () => {
    expect(relacoesEntre(cadastro('+5511988880001', 'ana', '+551188880001'), cadastro('+5521977770002', 'bia', '+552177770002'))).toEqual([]);
    expect(relacoesEntre(cadastro('+55123', 'ana', null), cadastro('+55123', 'bia', null))).toEqual([]);
  });
});

describe('versaoDaPrevia', () => {
  it('mesmo conteúdo em qualquer ordem: mesma versão (hex de 64)', () => {
    const embaralhado = { ...BASE, agendamentos: [...BASE.agendamentos].reverse(), pedidosPublicos: [...BASE.pedidosPublicos] };
    expect(versaoDaPrevia(embaralhado)).toBe(versaoDaPrevia(BASE));
    expect(versaoDaPrevia(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each<[string, ConteudoDaUnificacao]>([
    ['nome do principal', { ...BASE, principal: { ...BASE.principal, name: 'Ana Maria' } }],
    ['e-mail do secundário', { ...BASE, secundario: { ...BASE.secundario, email: 'a@example.test' } }],
    ['secundário virou lápide', { ...BASE, secundario: { ...BASE.secundario, unificado: true } }],
    ['agendamento novo', { ...BASE, agendamentos: [...BASE.agendamentos, { id: 'a3', status: 'PENDING', startAt: '2026-12-01T12:00:00.000Z', precos: [5000] }] }],
    ['situação do agendamento', { ...BASE, agendamentos: [{ ...BASE.agendamentos[0], status: 'NO_SHOW' }, BASE.agendamentos[1]] }],
    ['horário do agendamento', { ...BASE, agendamentos: [{ ...BASE.agendamentos[0], startAt: '2026-11-01T13:00:00.000Z' }, BASE.agendamentos[1]] }],
    ['preço do item', { ...BASE, agendamentos: [{ ...BASE.agendamentos[0], precos: [5500] }, BASE.agendamentos[1]] }],
    ['recebimento registrado', { ...BASE, recebimentos: [...BASE.recebimentos, { ...BASE.recebimentos[0], id: 'r2' }] }],
    ['estorno', { ...BASE, recebimentos: [{ ...BASE.recebimentos[0], refunded: true }] }],
    ['comissão apurada', { ...BASE, comissoes: [...BASE.comissoes, { ...BASE.comissoes[0], id: 'c2' }] }],
    ['comissão revertida', { ...BASE, comissoes: [{ ...BASE.comissoes[0], status: 'REVERSED' }] }],
    ['pedido público', { ...BASE, pedidosPublicos: [] }],
  ])('muda quando muda: %s', (_rotulo, outro) => {
    expect(versaoDaPrevia(outro)).not.toBe(versaoDaPrevia(BASE));
  });
});

describe('resumo e prévia', () => {
  it('conta por situação e o que segue pelos agendamentos, sem somar valores', () => {
    expect(resumoDaTransferencia(BASE)).toEqual({
      agendamentos: 2,
      concluidos: 1,
      cancelados: 1,
      faltas: 0,
      outros: 0,
      recebimentos: 1,
      comissoes: 1,
      pedidosPublicos: 1,
    });
  });

  it('a prévia não expõe a marca interna e leva a versão; a recusa traz a prévia nova', () => {
    const previa = previaDe(BASE, ['MESMO_TELEFONE']);
    expect(previa.principal).toEqual({ id: 'p1', name: 'Ana', whatsapp: '11 98888-0001', email: null });
    expect(previa.versaoDaPrevia).toBe(versaoDaPrevia(BASE));
    const recusa = previaDesatualizada(previa);
    expect(recusa.getStatus()).toBe(409);
    expect(recusa.getResponse()).toMatchObject({ code: 'PREVIA_DESATUALIZADA', previa });
  });
});
