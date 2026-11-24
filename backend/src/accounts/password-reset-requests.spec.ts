// Regras puras de "Esqueci minha senha": quem recebe o link, quando um link
// pendente é preservado, o limite por conta e a nova tentativa do envio. O
// fluxo contra PostgreSQL: test/password-recovery-postgres.db-e2e-spec.ts.
import { passwordResetRequestSchema } from './accounts.dto.js';
import {
  MAX_DELIVERY_ATTEMPTS,
  SELF_SERVICE_HOURLY_LIMIT,
  contaElegivel,
  decidirPedido,
  proximoEnvio,
  type ContaDoPedido,
} from './password-reset-requests.js';

const ELEGIVEL: ContaDoPedido = { status: 'ACTIVE', has_credential: true, email: 'ana@example.test', email_verified: true };
const decidir = (contas: ContaDoPedido[], linkPendenteValido = false, emitidosNaUltimaHora = 0) =>
  decidirPedido({ contas, linkPendenteValido, emitidosNaUltimaHora });

describe('contaElegivel', () => {
  it('só conta ativa, com senha e com e-mail CONFIRMADO', () => {
    expect(contaElegivel(ELEGIVEL)).toBe(true);
    expect(contaElegivel({ ...ELEGIVEL, email_verified: false })).toBe(false);
    expect(contaElegivel({ ...ELEGIVEL, email: null })).toBe(false);
    expect(contaElegivel({ ...ELEGIVEL, has_credential: false })).toBe(false);
    expect(contaElegivel({ ...ELEGIVEL, status: 'SUSPENDED' })).toBe(false);
    expect(contaElegivel({ ...ELEGIVEL, status: 'INVITED' })).toBe(false);
  });
});

describe('decidirPedido', () => {
  it('sem conta: NO_MATCH; mais de uma: ninguém recebe', () => {
    expect(decidir([])).toBe('NO_MATCH');
    expect(decidir([ELEGIVEL, ELEGIVEL])).toBe('NOT_ELIGIBLE');
  });

  it('login de equipe (sem e-mail), e-mail não confirmado, bloqueada ou sem senha: NOT_ELIGIBLE', () => {
    expect(decidir([{ ...ELEGIVEL, email: null }])).toBe('NOT_ELIGIBLE');
    expect(decidir([{ ...ELEGIVEL, email_verified: false }])).toBe('NOT_ELIGIBLE');
    expect(decidir([{ ...ELEGIVEL, status: 'SUSPENDED' }])).toBe('NOT_ELIGIBLE');
    expect(decidir([{ ...ELEGIVEL, has_credential: false }])).toBe('NOT_ELIGIBLE');
  });

  it('link pendente válido (de qualquer origem) é preservado: nada novo', () => {
    expect(decidir([ELEGIVEL], true)).toBe('ACTIVE_LINK_KEPT');
    // Preservar vem antes do limite.
    expect(decidir([ELEGIVEL], true, SELF_SERVICE_HOURLY_LIMIT)).toBe('ACTIVE_LINK_KEPT');
  });

  it('limite por conta: a partir do terceiro link na hora, nada é emitido', () => {
    expect(SELF_SERVICE_HOURLY_LIMIT).toBe(3);
    expect(decidir([ELEGIVEL], false, SELF_SERVICE_HOURLY_LIMIT - 1)).toBe('ISSUED');
    expect(decidir([ELEGIVEL], false, SELF_SERVICE_HOURLY_LIMIT)).toBe('ACCOUNT_LIMIT');
  });
});

describe('proximoEnvio', () => {
  const agora = new Date('2026-11-24T12:00:00Z');
  const expira = new Date('2026-11-24T13:00:00Z');

  it('aceito pelo provedor ou sem provedor configurado: termina', () => {
    expect(proximoEnvio({ status: 'SENT' }, 1, agora, expira)).toBeNull();
    expect(proximoEnvio({ status: 'NOT_CONFIGURED' }, 0, agora, expira)).toBeNull();
  });

  it('recusa: volta à fila com espera de 1 e depois 5 minutos, até 3 tentativas', () => {
    const falha = { status: 'FAILED', failure: 'HTTP_5XX' } as const;
    expect(proximoEnvio(falha, 1, agora, expira)).toEqual(new Date('2026-11-24T12:01:00Z'));
    expect(proximoEnvio(falha, 2, agora, expira)).toEqual(new Date('2026-11-24T12:05:00Z'));
    expect(proximoEnvio(falha, MAX_DELIVERY_ATTEMPTS, agora, expira)).toBeNull();
  });

  it('nunca reagenda para depois de o link expirar', () => {
    const falha = { status: 'FAILED', failure: 'SEM_RESPOSTA' } as const;
    expect(proximoEnvio(falha, 1, agora, new Date('2026-11-24T12:00:30Z'))).toBeNull();
  });
});

describe('passwordResetRequestSchema', () => {
  it('aceita e-mail ou login, com a normalização do login', () => {
    expect(passwordResetRequestSchema.parse({ identifier: '  Ana@Example.TEST ' })).toEqual({ identifier: 'ana@example.test' });
    expect(passwordResetRequestSchema.parse({ identifier: 'Maria@Salao' })).toEqual({ identifier: 'maria@salao' });
    expect(passwordResetRequestSchema.parse({ identifier: 'joao.silva' })).toEqual({ identifier: 'joao.silva' });
  });

  it('recusa forma inválida, campo extra e destinatário alternativo', () => {
    expect(passwordResetRequestSchema.safeParse({ identifier: '' }).success).toBe(false);
    expect(passwordResetRequestSchema.safeParse({ identifier: 'a b' }).success).toBe(false);
    expect(passwordResetRequestSchema.safeParse({ identifier: 'x'.repeat(255) }).success).toBe(false);
    expect(
      passwordResetRequestSchema.safeParse({ identifier: 'ana@example.test', email: 'outra@example.test' }).success,
    ).toBe(false);
    expect(passwordResetRequestSchema.safeParse({ identifier: 'ana@example.test', to: 'x@example.test' }).success).toBe(false);
  });
});
