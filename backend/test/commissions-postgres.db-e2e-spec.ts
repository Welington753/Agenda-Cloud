// Comissões por profissional e serviço contra PostgreSQL DESCARTÁVEL (dados
// fictícios; ver docs/plans/comissoes-profissional-servico.md). Prova:
// - regras: percentual, fixo, "sem comissão" e "não configurada", só para
//   serviço que o profissional atende, com histórico;
// - reserva com vários serviços: cada item calculado no servidor pelo preço
//   registrado, total = soma, uma linha por item;
// - repetir a conclusão (em série e em paralelo) não duplica;
// - mudar a regra depois não recalcula o histórico, e atendimento concluído
//   antes do recurso ou da regra não ganha comissão retroativa;
// - cancelado e falta fora do total; atendimento concluído não cancela;
//   reabertura futura preserva a fotografia;
// - estorno do recebimento sinaliza, não apaga;
// - isolamento entre estabelecimentos e recusas de acesso;
// - planos: comissões no Pro (código `equipe`) e no Max (código `pro`), não
//   no Básico (código `essencial`), onde concluir segue normal; a exceção
//   individual vence o plano, e o plano não concede nada ao funcionário;
// - aplicação em massa da regra geral (substituir e preservar), com prévia,
//   impressão, 409, travas, 200 profissionais, auditoria e isolamento.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { apurarNaConclusao, configuracaoTravada, reverterApuracao } from '../src/commissions/commission-accrual.js';
import { CommissionsService } from '../src/commissions/commissions.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { BusinessCategory } from '../src/entities/enums/business-category.enum.js';
import { EstablishmentRole } from '../src/entities/enums/establishment-role.enum.js';
import { ServiceModality } from '../src/entities/enums/service-modality.enum.js';
import { TenantStatus } from '../src/entities/enums/tenant-status.enum.js';
import { UserStatus } from '../src/entities/enums/user-status.enum.js';
import { Membership } from '../src/entities/membership.entity.js';
import { Tenant } from '../src/entities/tenant.entity.js';
import { Unit } from '../src/entities/unit.entity.js';
import { User } from '../src/entities/user.entity.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { ProfessionalsService } from '../src/professionals/professionals.service.js';
import { ProfessionalWorkingHoursService } from '../src/professionals/working-hours.service.js';
import { ServicesService } from '../src/services/services.service.js';
import { MyAgendaService } from '../src/team/my-agenda.service.js';
import { resolveTeamManager } from '../src/team/team-authorization.js';

const DIRECT_URL = process.env.DB_E2E_DIRECT_URL;
if (DIRECT_URL && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(DIRECT_URL).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const testDir = path.dirname(fileURLToPath(import.meta.url));

async function carregarEntidades(): Promise<(new () => object)[]> {
  const classes: (new () => object)[] = [];
  for (const arquivo of globSync(path.join(testDir, '../src/entities/**/*.entity.ts').replaceAll('\\', '/'))) {
    const modulo = (await import(pathToFileURL(arquivo).href)) as Record<string, unknown>;
    for (const exportado of Object.values(modulo)) {
      if (typeof exportado === 'function') classes.push(exportado as new () => object);
    }
  }
  return classes;
}

/** Domingos no futuro; horários em São Paulo (UTC−3). */
const WEEKDAY = 0;
const as = (data: string, hora: number) => `${data}T${String(hora + 3).padStart(2, '0')}:00:00.000Z`;
const DIA = '2026-09-20';
const OUTRO_DIA = '2026-09-27';
const MES = { from: '2026-09-01', to: '2026-09-30' };
const ANTES = new Date('2026-09-01T12:00:00Z');
const DEPOIS = new Date('2026-09-28T12:00:00Z');

interface Cenario {
  tenantId: string;
  dono: string;
  ana: string;
  bia: string;
  corte: string;
  barba: string;
  avaliacao: string;
  consumidor: string;
}

interface Linha {
  appointment_item_id: string;
  service_id: string;
  price_cents_snapshot: number | null;
  applied_type: string | null;
  applied_value: number | null;
  applied_rule_scope: string | null;
  professional_cents: number | null;
  establishment_cents: number | null;
  status: string;
  calculated_at: Date;
}

describe.skipIf(!DIRECT_URL)('comissões por profissional e serviço contra PostgreSQL descartável', () => {
  let db: DataSource;
  let agendamentos: AppointmentsService;
  let comissoes: CommissionsService;
  let agendaPropria: MyAgendaService;
  let recebimentos: PaymentsService;
  let profissionais: ProfessionalsService;
  let servicos: ServicesService;
  let horarios: ProfessionalWorkingHoursService;
  let clientes: ConsumersService;
  let relogio = ANTES;
  let contas = 0;
  const planos: Record<string, string> = {};
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  async function usuario(nome: string) {
    return db.manager.save(
      db.manager.create(User, { name: nome, email: `${nome.toLowerCase().replaceAll(' ', '-')}-${sufixo}@example.test`, status: UserStatus.ACTIVE }),
    );
  }

  async function cenario(nome: string, plano: 'pro' | 'equipe' | 'essencial' = 'pro'): Promise<Cenario> {
    const m = db.manager;
    const tenant = await m.save(
      m.create(Tenant, {
        slug: `e2e-comissoes-${nome}-${sufixo}`,
        category: BusinessCategory.BARBERSHOP,
        timezone: 'America/Sao_Paulo',
        planId: planos[plano],
        status: TenantStatus.ACTIVE,
      }),
    );
    await m.query('UPDATE tenants SET access_legacy_since = now() WHERE id = $1', [tenant.id]);
    await m.save(m.create(Unit, { tenantId: tenant.id, name: `Unidade ${nome}`, address: '', timezone: 'America/Sao_Paulo', isPrimary: true }));
    const dono = await usuario(`Dono ${nome}`);
    await m.save(m.create(Membership, { userId: dono.id, tenantId: tenant.id, role: EstablishmentRole.DONO }));
    const base = {
      shortDescription: '',
      priceVisible: true,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
      bufferAfterMinutes: 0,
    };
    const corte = await servicos.create(dono.id, tenant.id, { ...base, name: 'Corte', priceCents: 4250, durationMinutes: 30 });
    const barba = await servicos.create(dono.id, tenant.id, { ...base, name: 'Barba', priceCents: 2500, durationMinutes: 30 });
    const avaliacao = await servicos.create(dono.id, tenant.id, { ...base, name: 'Avaliação', priceCents: 1000, durationMinutes: 30 });
    // Sob consulta: sem preço registrado.
    await m.query('UPDATE services SET price_cents = NULL WHERE id = $1', [avaliacao.id]);
    const ana = await profissionais.create(dono.id, tenant.id, { name: `Ana ${nome}`, serviceIds: [corte.id, barba.id, avaliacao.id] });
    const bia = await profissionais.create(dono.id, tenant.id, { name: `Bia ${nome}`, serviceIds: [corte.id] });
    for (const p of [ana, bia]) {
      await horarios.replace(dono.id, tenant.id, p.id, { days: [{ weekday: WEEKDAY, intervals: [{ start: '08:00', end: '20:00' }] }] });
    }
    // Profissional cadastrado agora começa sem receber comissão. Os cenários
    // abaixo partem de "recebe, sem regra geral" (o estado de quem já existia
    // antes da regra geral); os casos próprios da configuração ligam e
    // desligam pelo serviço.
    await m.query('UPDATE professional_commission_settings SET receives_commission = true WHERE tenant_id = $1', [tenant.id]);
    const consumidor = await clientes.create(dono.id, tenant.id, {
      name: `Cliente ${nome}`,
      whatsapp: `(11) 9${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
    });
    return {
      tenantId: tenant.id,
      dono: dono.id,
      ana: ana.id,
      bia: bia.id,
      corte: corte.id,
      barba: barba.id,
      avaliacao: avaliacao.id,
      consumidor: consumidor.id,
    };
  }

  async function reservar(c: Cenario, serviceIds: string[], startAt: string, professionalId = c.ana) {
    relogio = ANTES;
    return agendamentos.create(c.dono, c.tenantId, {
      professionalId,
      serviceIds,
      startAt,
      consumer: { mode: 'existing', consumerId: c.consumidor },
    });
  }

  async function concluir(c: Cenario, id: string, startAt: string) {
    relogio = DEPOIS;
    return agendamentos.changeStatus(c.dono, c.tenantId, id, 'complete', { expectedStartAt: startAt });
  }

  const linhas = (appointmentId: string) =>
    db.query(
      `SELECT ce.appointment_item_id, ce.service_id, ce.price_cents_snapshot, ce.applied_type::text AS applied_type,
              ce.applied_value, ce.applied_rule_scope, ce.professional_cents, ce.establishment_cents, ce.status::text AS status,
              ce.calculated_at
         FROM commission_entries ce JOIN appointment_items ai ON ai.id = ce.appointment_item_id
        WHERE ce.appointment_id = $1 ORDER BY ai.position`,
      [appointmentId],
    ) as Promise<Linha[]>;

  async function funcionario(c: Cenario, professionalId: string, role: 'PROFISSIONAL' | 'GERENTE', concessoes: string[]) {
    contas += 1;
    const u = await usuario(`${role} ${contas}`);
    const [{ id: membershipId }] = (await db.query(
      `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, status, created_at, permissions_confirmed_at)
       VALUES (substr(md5(random()::text), 1, 24), $1, $2, $3::establishment_role, $4, 'ACTIVE', now(), now()) RETURNING id`,
      [u.id, c.tenantId, role, professionalId],
    )) as { id: string }[];
    for (const p of concessoes) {
      await db.query(
        `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
         VALUES (substr(md5(random()::text), 1, 24), $1, $2, $3::permission, 'GRANTED')`,
        [c.tenantId, membershipId, p],
      );
    }
    return u.id;
  }

  beforeAll(async () => {
    db = new DataSource({ ...buildRuntimeDataSourceOptions(DIRECT_URL as string), entities: await carregarEntidades(), logging: ['error'] });
    await db.initialize();
    const disponibilidade = new AvailabilityService(db, () => relogio);
    clientes = new ConsumersService(db);
    agendamentos = new AppointmentsService(db, disponibilidade, clientes, () => relogio);
    comissoes = new CommissionsService(db);
    agendaPropria = new MyAgendaService(db, agendamentos);
    recebimentos = new PaymentsService(db);
    profissionais = new ProfessionalsService(db);
    servicos = new ServicesService(db);
    horarios = new ProfessionalWorkingHoursService(db);
    for (const l of (await db.query(`SELECT id, code FROM plans`)) as { id: string; code: string }[]) planos[l.code] = l.id;
    if (!planos.pro || !planos.equipe || !planos.essencial) throw new Error('Catálogo de planos ausente — migrations não foram aplicadas.');
  }, 30_000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('catálogo: comissões no Pro (equipe) e no Max (pro), não no Básico (essencial); o resto dos planos igual', async () => {
    const linhasCatalogo = (await db.query(
      `SELECT p.code FROM plan_features pf JOIN plans p ON p.id = pf.plan_id JOIN features f ON f.id = pf.feature_id
        WHERE f.key = 'COMISSOES' AND p.code IN ('essencial', 'equipe', 'pro') ORDER BY p.code`,
    )) as { code: string }[];
    expect(linhasCatalogo.map((l) => l.code)).toEqual(['equipe', 'pro']);
    // Só a linha nova de comissões no Pro; nomes, limites e os demais
    // recursos continuam os do catálogo anterior.
    const catalogo = (await db.query(
      `SELECT p.code, p.name, p.max_professionals, p.max_units, array_agg(f.key::text ORDER BY f.key::text) AS recursos
         FROM plans p JOIN plan_features pf ON pf.plan_id = p.id JOIN features f ON f.id = pf.feature_id
        WHERE p.code IN ('essencial', 'equipe', 'pro') GROUP BY p.code, p.name, p.max_professionals, p.max_units
        ORDER BY p.code`,
    )) as { code: string; name: string; max_professionals: number; max_units: number; recursos: string[] }[];
    expect(catalogo.map(({ recursos, ...plano }) => ({ ...plano, recursos: recursos.length }))).toEqual([
      { code: 'equipe', name: 'Pro', max_professionals: 5, max_units: 1, recursos: 8 },
      { code: 'essencial', name: 'Básico', max_professionals: 2, max_units: 1, recursos: 6 },
      { code: 'pro', name: 'Max', max_professionals: 20, max_units: 5, recursos: 13 },
    ]);
    expect(catalogo[0].recursos).toEqual(['AGENDA', 'AGENDAMENTO_PUBLICO', 'COMISSOES', 'CONSUMIDORES', 'EQUIPE', 'PAGAMENTOS', 'PROFISSIONAIS', 'RELATORIOS']);
    expect(catalogo[1].recursos).not.toContain('COMISSOES');
  });

  it('plano Pro: o dono apura e consulta; exceção individual vence o plano; o funcionário depende da concessão', async () => {
    const c = await cenario('plano-pro', 'equipe');
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'PERCENTAGE', value: 1000 });
    const reserva = await reservar(c, [c.corte], as(DIA, 9));
    await concluir(c, reserva.id, as(DIA, 9));
    // 10% de 42,50 = 4,25.
    expect((await comissoes.report(c.dono, c.tenantId, MES)).totalAccruedCents).toBe(425);
    // O recurso no plano não libera nada ao funcionário: só a concessão.
    expect((await resolveTeamManager(db.manager, c.dono, c.tenantId)).grantable).toContain('COMISSOES_PROPRIAS_VISUALIZAR');
    const semConcessao = await funcionario(c, c.ana, 'PROFISSIONAL', []);
    await expect(agendaPropria.commissions(semConcessao, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    await expect(comissoes.report(semConcessao, c.tenantId, MES)).rejects.toThrow(ForbiddenException);

    // Exceção individual desligada num Pro: recusa e não apura; concluir segue normal.
    await db.query(
      `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled)
       SELECT substr(md5(random()::text), 1, 24), $1, id, false FROM features WHERE key = 'COMISSOES'`,
      [c.tenantId],
    );
    await expect(comissoes.report(c.dono, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    const desligada = await reservar(c, [c.corte], as(DIA, 10));
    expect((await concluir(c, desligada.id, as(DIA, 10))).status).toBe('COMPLETED');
    expect(await linhas(desligada.id)).toEqual([]);

    // Exceção individual ligada num Básico: funciona como no plano.
    const basico = await cenario('basico-com-excecao', 'essencial');
    await expect(comissoes.rules(basico.dono, basico.tenantId, basico.ana)).rejects.toThrow(ForbiddenException);
    expect((await resolveTeamManager(db.manager, basico.dono, basico.tenantId)).grantable).not.toContain('COMISSOES_PROPRIAS_VISUALIZAR');
    await db.query(
      `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled)
       SELECT substr(md5(random()::text), 1, 24), $1, id, true FROM features WHERE key = 'COMISSOES'`,
      [basico.tenantId],
    );
    await comissoes.setRule(basico.dono, basico.tenantId, basico.ana, basico.corte, { kind: 'FIXED', value: 500 });
    const comExcecao = await reservar(basico, [basico.corte], as(DIA, 9));
    await concluir(basico, comExcecao.id, as(DIA, 9));
    expect((await comissoes.report(basico.dono, basico.tenantId, MES)).totalAccruedCents).toBe(500);
  });

  it('regras: percentual, fixo, sem comissão e não configurada, só em serviço atendido, com histórico', async () => {
    const c = await cenario('regras');
    const inicial = await comissoes.rules(c.dono, c.tenantId, c.ana);
    expect(inicial.services.map((s) => [s.service.name, s.linked, s.rule])).toEqual([
      ['Avaliação', true, null],
      ['Barba', true, null],
      ['Corte', true, null],
    ]);
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'PERCENTAGE', value: 1250 });
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.barba, { kind: 'FIXED', value: 990 });
    const depois = await comissoes.setRule(c.dono, c.tenantId, c.ana, c.avaliacao, { kind: 'NONE' });
    expect(depois.services.map((s) => [s.service.name, s.rule])).toEqual([
      ['Avaliação', { kind: 'NONE', value: null }],
      ['Barba', { kind: 'FIXED', value: 990 }],
      ['Corte', { kind: 'PERCENTAGE', value: 1250 }],
    ]);
    // Repetir o mesmo valor não grava nem audita de novo.
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'PERCENTAGE', value: 1250 });
    // Voltar a "não configurada".
    const limpo = await comissoes.clearRule(c.dono, c.tenantId, c.ana, c.avaliacao);
    expect(limpo.services.find((s) => s.service.id === c.avaliacao)!.rule).toBeNull();
    // Bia não atende Barba.
    await expect(comissoes.setRule(c.dono, c.tenantId, c.bia, c.barba, { kind: 'FIXED', value: 100 })).rejects.toThrow(
      ConflictException,
    );
    const historico = (await db.query(
      `SELECT summary FROM audit_logs WHERE tenant_id = $1 AND action = 'COMMISSION_RULE_CHANGED' ORDER BY occurred_at, id`,
      [c.tenantId],
    )) as { summary: string }[];
    expect(historico.map((h) => h.summary)).toEqual([
      `Comissão de Ana regras em Corte: não configurada → 12.50%.`,
      `Comissão de Ana regras em Barba: não configurada → R$ 9.90 fixo.`,
      `Comissão de Ana regras em Avaliação: não configurada → sem comissão.`,
      `Comissão de Ana regras em Avaliação: sem comissão → não configurada.`,
    ]);
  });

  it('reserva com vários serviços: cada item pelo preço registrado, soma, sem duplicar ao repetir', async () => {
    const c = await cenario('multi');
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'PERCENTAGE', value: 4000 });
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.barba, { kind: 'FIXED', value: 1000 });
    const inicio = as(DIA, 9);
    const reserva = await reservar(c, [c.corte, c.barba], inicio);
    // O preço do catálogo muda depois da reserva: vale o registrado no item.
    await db.query('UPDATE services SET price_cents = 9900 WHERE id = $1', [c.corte]);

    // Duas conclusões simultâneas e uma repetição: uma única apuração.
    await Promise.all([concluir(c, reserva.id, inicio), concluir(c, reserva.id, inicio)]);
    await concluir(c, reserva.id, inicio);
    const gravadas = await linhas(reserva.id);
    expect(gravadas.map((l) => [l.service_id, l.price_cents_snapshot, l.applied_type, l.applied_value, l.professional_cents, l.establishment_cents])).toEqual([
      [c.corte, 4250, 'PERCENTAGE', 4000, 1700, 2550],
      [c.barba, 2500, 'FIXED', 1000, 1000, 1500],
    ]);
    expect(((await db.query('SELECT count(*)::int AS n FROM commission_entries WHERE appointment_id = $1', [reserva.id])) as { n: number }[])[0].n).toBe(2);
    // Chamar a apuração de novo direto também não grava nada.
    await db.transaction((m) => apurarNaConclusao(m, { tenantId: c.tenantId, id: reserva.id, professionalId: c.ana, startAt: new Date(inicio) }, DEPOIS));
    expect(await linhas(reserva.id)).toEqual(gravadas);

    const relatorio = await comissoes.report(c.dono, c.tenantId, MES);
    expect(relatorio.basis).toBe('APURADA_NA_CONCLUSAO');
    expect(relatorio.totalAccruedCents).toBe(2700);
    expect(relatorio.professionals).toEqual([
      expect.objectContaining({ professional: expect.objectContaining({ id: c.ana }), accruedCents: 2700, appointments: 1, items: 2 }),
    ]);
    expect(relatorio.appointments[0]).toMatchObject({
      id: reserva.id,
      localDate: DIA,
      localStart: '09:00',
      counted: true,
      commissionCents: 2700,
      clientPayment: 'SEM_RECEBIMENTO',
      flags: [],
      items: [
        { serviceName: 'Corte', priceCents: 4250, rule: { kind: 'PERCENTAGE', value: 4000 }, commissionCents: 1700, situation: 'OK' },
        { serviceName: 'Barba', priceCents: 2500, rule: { kind: 'FIXED', value: 1000 }, commissionCents: 1000, situation: 'OK' },
      ],
    });
  });

  it('mudar a regra depois não recalcula; antes da regra ou do recurso não há comissão retroativa', async () => {
    const c = await cenario('historico');
    // Concluída sem regra: fica "não configurada" para sempre.
    const semRegra = await reservar(c, [c.corte], as(DIA, 9));
    await concluir(c, semRegra.id, as(DIA, 9));
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'PERCENTAGE', value: 5000 });
    const comRegra = await reservar(c, [c.corte], as(DIA, 10));
    await concluir(c, comRegra.id, as(DIA, 10));
    const antes = await linhas(comRegra.id);
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'FIXED', value: 100 });
    await comissoes.clearRule(c.dono, c.tenantId, c.ana, c.corte);
    expect(await linhas(comRegra.id)).toEqual(antes);
    expect((await linhas(semRegra.id)).map((l) => [l.applied_type, l.professional_cents])).toEqual([[null, null]]);
    const relatorio = await comissoes.report(c.dono, c.tenantId, MES);
    // 50% de 42,50 = 21,25; a sem regra não soma nada e pede conferência.
    expect(relatorio.totalAccruedCents).toBe(2125);
    expect(relatorio.professionals[0].review).toMatchObject({ notConfigured: 1 });
    expect(relatorio.appointments.find((a) => a.id === semRegra.id)!.flags).toEqual(['NAO_CONFIGURADA']);

    // Estabelecimento sem o recurso: concluir não apura; ligar depois não
    // inventa comissão para o que já foi concluído.
    const semRecurso = await cenario('sem-recurso', 'essencial');
    const antiga = await reservar(semRecurso, [semRecurso.corte], as(DIA, 9));
    // No Básico, concluir segue normal: só não apura.
    expect((await concluir(semRecurso, antiga.id, as(DIA, 9))).status).toBe('COMPLETED');
    expect(await linhas(antiga.id)).toEqual([]);
    await expect(comissoes.report(semRecurso.dono, semRecurso.tenantId, MES)).rejects.toThrow(ForbiddenException);
    await db.query('UPDATE tenants SET plan_id = $2 WHERE id = $1', [semRecurso.tenantId, planos.pro]);
    await comissoes.setRule(semRecurso.dono, semRecurso.tenantId, semRecurso.ana, semRecurso.corte, { kind: 'PERCENTAGE', value: 4000 });
    const vazio = await comissoes.report(semRecurso.dono, semRecurso.tenantId, MES);
    expect(vazio.totalAccruedCents).toBe(0);
    expect(vazio.appointments).toEqual([]);
  });

  it('troca de plano Pro → Básico → Pro: histórico intacto, sem apuração no Básico e sem retroativo na volta', async () => {
    const c = await cenario('rebaixado', 'equipe');
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'PERCENTAGE', value: 2000 });
    const funcionaria = await funcionario(c, c.ana, 'PROFISSIONAL', ['COMISSOES_PROPRIAS_VISUALIZAR']);
    const noPro = await reservar(c, [c.corte], as(DIA, 9));
    await concluir(c, noPro.id, as(DIA, 9));
    const fotografia = await linhas(noPro.id);
    // 20% de 42,50 = 8,50.
    expect(fotografia.map((l) => l.professional_cents)).toEqual([850]);

    // Rebaixado para o Básico: relatório, regras e a visão própria recusam; concluir segue normal, sem apurar.
    await db.query('UPDATE tenants SET plan_id = $2 WHERE id = $1', [c.tenantId, planos.essencial]);
    await expect(comissoes.report(c.dono, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    await expect(comissoes.rules(c.dono, c.tenantId, c.ana)).rejects.toThrow(ForbiddenException);
    await expect(agendaPropria.commissions(funcionaria, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    const noBasico = await reservar(c, [c.corte], as(DIA, 10));
    expect((await concluir(c, noBasico.id, as(DIA, 10))).status).toBe('COMPLETED');
    expect(await linhas(noBasico.id)).toEqual([]);
    // A regra gravada e a apuração anterior continuam no banco, sem mudança.
    expect(await linhas(noPro.id)).toEqual(fotografia);
    expect(
      await db.query('SELECT type::text AS type, value FROM commission_rules WHERE tenant_id = $1', [c.tenantId]),
    ).toEqual([{ type: 'PERCENTAGE', value: 2000 }]);

    // De volta ao Pro: o histórico reaparece igual, e o concluído no Básico continua sem comissão.
    await db.query('UPDATE tenants SET plan_id = $2 WHERE id = $1', [c.tenantId, planos.equipe]);
    const relatorio = await comissoes.report(c.dono, c.tenantId, MES);
    expect(relatorio.totalAccruedCents).toBe(850);
    expect(relatorio.appointments.map((a) => a.id)).toEqual([noPro.id]);
    expect((await agendaPropria.commissions(funcionaria, c.tenantId, MES)).totalAccruedCents).toBe(850);
    expect(await linhas(noBasico.id)).toEqual([]);
  });

  it('cancelado e falta fora do total; concluído não cancela; reabertura futura preserva a fotografia', async () => {
    const c = await cenario('ciclo');
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'PERCENTAGE', value: 4000 });
    const cancelada = await reservar(c, [c.corte], as(DIA, 9));
    await agendamentos.cancel(c.dono, c.tenantId, cancelada.id, { expectedStartAt: as(DIA, 9) });
    const falta = await reservar(c, [c.corte], as(DIA, 10));
    relogio = DEPOIS;
    await agendamentos.changeStatus(c.dono, c.tenantId, falta.id, 'no-show', { expectedStartAt: as(DIA, 10) });
    const feita = await reservar(c, [c.corte], as(DIA, 11));
    await concluir(c, feita.id, as(DIA, 11));
    expect(await linhas(cancelada.id)).toEqual([]);
    expect(await linhas(falta.id)).toEqual([]);
    const fotografia = await linhas(feita.id);
    // Hoje COMPLETED é final: cancelar um concluído é recusado e nada muda.
    await expect(agendamentos.cancel(c.dono, c.tenantId, feita.id, { expectedStartAt: as(DIA, 11) })).rejects.toThrow(
      BadRequestException,
    );
    expect(await linhas(feita.id)).toEqual(fotografia);
    expect((await comissoes.report(c.dono, c.tenantId, MES)).totalAccruedCents).toBe(1700);

    // Reabertura (lote futuro): a apuração é revertida, sai do total e fica
    // listada; concluir de novo reativa a MESMA fotografia, mesmo com outra regra.
    await db.transaction(async (m) => {
      await m.query(`UPDATE appointments SET status = 'IN_PROGRESS' WHERE id = $1`, [feita.id]);
      await reverterApuracao(m, { tenantId: c.tenantId, id: feita.id }, DEPOIS);
    });
    const reaberto = await comissoes.report(c.dono, c.tenantId, MES);
    expect(reaberto.totalAccruedCents).toBe(0);
    expect(reaberto.professionals[0].review.outOfTotal).toBe(1);
    expect(reaberto.appointments.find((a) => a.id === feita.id)).toMatchObject({ counted: false, flags: ['FORA_DO_TOTAL'] });
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'FIXED', value: 5 });
    await concluir(c, feita.id, as(DIA, 11));
    const reativada = await linhas(feita.id);
    expect(reativada.map((l) => [l.status, l.applied_type, l.applied_value, l.professional_cents])).toEqual([
      ['CONFIRMED', 'PERCENTAGE', 4000, 1700],
    ]);
    expect((await comissoes.report(c.dono, c.tenantId, MES)).totalAccruedCents).toBe(1700);
  });

  it('sob consulta, acima do preço e estorno do recebimento: sinalizados, nada apagado', async () => {
    const c = await cenario('conferencia');
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.avaliacao, { kind: 'PERCENTAGE', value: 3000 });
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.barba, { kind: 'FIXED', value: 3000 });
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'PERCENTAGE', value: 1000 });
    const semPreco = await reservar(c, [c.avaliacao], as(DIA, 9));
    await concluir(c, semPreco.id, as(DIA, 9));
    const acima = await reservar(c, [c.barba], as(DIA, 10));
    await concluir(c, acima.id, as(DIA, 10));
    const paga = await reservar(c, [c.corte], as(DIA, 11));
    await concluir(c, paga.id, as(DIA, 11));
    const { payment } = await recebimentos.record(c.dono, c.tenantId, {
      requestKey: `chave-${sufixo}`,
      appointmentId: paga.id,
      amountCents: 4250,
      method: 'PIX',
      receivedOn: DIA,
    });
    const recebido = await comissoes.report(c.dono, c.tenantId, MES);
    expect(recebido.appointments.find((a) => a.id === paga.id)!.clientPayment).toBe('RECEBIDO');
    // Estorno integral (o da tela exige senha recente; aqui, o mesmo efeito no banco).
    await db.query(
      `UPDATE appointment_payments SET refunded_at = now(), refunded_on = $2::date, refund_reason = 'teste', refunded_by_user_id = $3
        WHERE id = $1`,
      [payment.id, DIA, c.dono],
    );
    const relatorio = await comissoes.report(c.dono, c.tenantId, MES);
    expect(relatorio.professionals[0]).toMatchObject({
      // 3000 (fixo acima do preço) + 425 (10% de 42,50); sob consulta não soma.
      accruedCents: 3425,
      appointments: 3,
      review: { notConfigured: 0, withoutPrice: 1, abovePrice: 1, refundedPayment: 1, outOfTotal: 0 },
    });
    const porId = new Map(relatorio.appointments.map((a) => [a.id, a]));
    expect(porId.get(semPreco.id)!.flags).toEqual(['SEM_PRECO']);
    expect(porId.get(acima.id)!.flags).toEqual(['ACIMA_DO_PRECO']);
    expect(porId.get(paga.id)).toMatchObject({ clientPayment: 'ESTORNADO', counted: true, commissionCents: 425, flags: ['RECEBIMENTO_ESTORNADO'] });
    expect((await linhas(paga.id))[0]).toMatchObject({ status: 'CONFIRMED', professional_cents: 425 });
    expect((await linhas(acima.id))[0]).toMatchObject({ professional_cents: 3000, establishment_cents: null });
  });

  it('período e profissional; isolamento e recusas; funcionário só vê as próprias, quando liberado', async () => {
    const c = await cenario('acesso');
    const outro = await cenario('acesso-outro');
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'PERCENTAGE', value: 4000 });
    await comissoes.setRule(c.dono, c.tenantId, c.bia, c.corte, { kind: 'FIXED', value: 800 });
    const daAna = await reservar(c, [c.corte], as(DIA, 9));
    await concluir(c, daAna.id, as(DIA, 9));
    const daBia = await reservar(c, [c.corte], as(DIA, 9), c.bia);
    await concluir(c, daBia.id, as(DIA, 9));
    const outroDia = await reservar(c, [c.corte], as(OUTRO_DIA, 9));
    await concluir(c, outroDia.id, as(OUTRO_DIA, 9));

    const mes = await comissoes.report(c.dono, c.tenantId, MES);
    expect(mes.professionals.map((p) => [p.professional.id, p.accruedCents, p.appointments])).toEqual([
      [c.ana, 3400, 2],
      [c.bia, 800, 1],
    ]);
    expect(mes.professionalOptions.map((p) => p.id).sort()).toEqual([c.ana, c.bia].sort());
    const soDia = await comissoes.report(c.dono, c.tenantId, { from: DIA, to: DIA });
    expect(soDia.totalAccruedCents).toBe(2500);
    const soBia = await comissoes.report(c.dono, c.tenantId, { ...MES, professionalId: c.bia });
    expect(soBia.appointments.map((a) => a.id)).toEqual([daBia.id]);

    // Isolamento: dono de outro estabelecimento, ids cruzados.
    await expect(comissoes.report(outro.dono, c.tenantId, MES)).rejects.toThrow(NotFoundException);
    await expect(comissoes.report(c.dono, c.tenantId, { ...MES, professionalId: outro.ana })).rejects.toThrow(NotFoundException);
    await expect(comissoes.rules(c.dono, c.tenantId, outro.ana)).rejects.toThrow(NotFoundException);
    await expect(comissoes.setRule(c.dono, c.tenantId, c.ana, outro.corte, { kind: 'NONE' })).rejects.toThrow(NotFoundException);
    await expect(comissoes.setRule(outro.dono, c.tenantId, c.ana, c.corte, { kind: 'NONE' })).rejects.toThrow(NotFoundException);
    expect((await comissoes.report(outro.dono, outro.tenantId, MES)).appointments).toEqual([]);

    // Dono com a consulta ou a configuração restringidas.
    const [{ id: membroDono }] = (await db.query('SELECT id FROM memberships WHERE tenant_id = $1 AND user_id = $2', [c.tenantId, c.dono])) as { id: string }[];
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       VALUES (substr(md5(random()::text), 1, 24), $1, $2, 'COMISSOES_GERENCIAR', 'DENIED')`,
      [c.tenantId, membroDono],
    );
    await expect(comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'NONE' })).rejects.toThrow(ForbiddenException);
    expect((await comissoes.report(c.dono, c.tenantId, MES)).totalAccruedCents).toBe(4200);
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       VALUES (substr(md5(random()::text), 1, 24), $1, $2, 'COMISSOES_VISUALIZAR', 'DENIED')`,
      [c.tenantId, membroDono],
    );
    await expect(comissoes.report(c.dono, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    await db.query(`DELETE FROM membership_permission_overrides WHERE membership_id = $1`, [membroDono]);

    // Gerente com todas as áreas concedidas e a permissão do dono: recusado.
    const gerente = await funcionario(c, c.bia, 'GERENTE', [
      'AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR', 'RECEBIMENTOS_VISUALIZAR', 'SERVICOS_VISUALIZAR', 'COMISSOES_VISUALIZAR', 'COMISSOES_GERENCIAR',
    ]);
    await expect(comissoes.report(gerente, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    await expect(comissoes.rules(gerente, c.tenantId, c.ana)).rejects.toThrow(ForbiddenException);
    // O levantamento de vagas de pilot-team-manager-check lista só os primeiros
    // estabelecimentos com gerente, no mesmo banco: o gerente sai daqui.
    await db.query(`DELETE FROM memberships WHERE user_id = $1`, [gerente]);

    // Funcionária sem a concessão: recusada, também no relatório geral.
    const anaSem = await funcionario(c, c.ana, 'PROFISSIONAL', ['COMISSOES_VISUALIZAR']);
    await expect(agendaPropria.commissions(anaSem, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    await expect(comissoes.report(anaSem, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    await db.query(`DELETE FROM memberships WHERE user_id = $1`, [anaSem]);

    // Com a concessão: só as próprias, sem o recebimento do cliente.
    const ana = await funcionario(c, c.ana, 'PROFISSIONAL', ['COMISSOES_PROPRIAS_VISUALIZAR']);
    const propria = await agendaPropria.commissions(ana, c.tenantId, MES);
    expect(propria.professional.id).toBe(c.ana);
    expect(propria.totalAccruedCents).toBe(3400);
    expect(propria.appointments.map((a) => a.professional.id)).toEqual([c.ana, c.ana]);
    expect(JSON.stringify(propria)).not.toMatch(/clientPayment|refundedPayment|ESTORNADO|RECEBIDO/);
    await expect(comissoes.report(ana, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    // Funcionária de outro estabelecimento: indistinguível de inexistente.
    const deFora = await funcionario(outro, outro.ana, 'PROFISSIONAL', ['COMISSOES_PROPRIAS_VISUALIZAR']);
    await expect(agendaPropria.commissions(deFora, c.tenantId, MES)).rejects.toThrow(NotFoundException);
    expect((await agendaPropria.commissions(deFora, outro.tenantId, MES)).appointments).toEqual([]);

    // A concessão só é oferecida com o recurso no plano; sem ele, a rota recusa.
    expect((await resolveTeamManager(db.manager, c.dono, c.tenantId)).grantable).toContain('COMISSOES_PROPRIAS_VISUALIZAR');
    await db.query('UPDATE tenants SET plan_id = $2 WHERE id = $1', [c.tenantId, planos.essencial]);
    expect((await resolveTeamManager(db.manager, c.dono, c.tenantId)).grantable).not.toContain('COMISSOES_PROPRIAS_VISUALIZAR');
    await expect(agendaPropria.commissions(ana, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    await expect(comissoes.report(c.dono, c.tenantId, MES)).rejects.toThrow(ForbiddenException);
    // As apurações continuam gravadas.
    expect(((await db.query('SELECT count(*)::int AS n FROM commission_entries WHERE tenant_id = $1', [c.tenantId])) as { n: number }[])[0].n).toBe(3);
  });
  // ------------------------------------------------------------------------
  // "Recebe comissão" e regra geral (migration ProfessionalCommissionSettings,
  // docs/plans/comissoes-regra-geral.md).
  // ------------------------------------------------------------------------

  const pct = (value: number) => ({ kind: 'PERCENTAGE' as const, value });
  const fixo = (value: number) => ({ kind: 'FIXED' as const, value });
  const total = async (c: Cenario) => (await comissoes.report(c.dono, c.tenantId, MES)).totalAccruedCents;
  const contar = async (appointmentId: string) =>
    ((await db.query('SELECT count(*)::int AS n FROM commission_entries WHERE appointment_id = $1', [appointmentId])) as { n: number }[])[0].n;
  const resumo = (l: Linha) => [l.service_id, l.applied_rule_scope, l.applied_type, l.applied_value, l.professional_cents];

  /** Prova de BLOQUEIO, não de lentidão: espera até `quantas` sessões estarem
   * paradas numa trava (`wait_event_type = 'Lock'`) por causa da sessão `pid`,
   * direta ou indiretamente (a segunda de uma fila espera a primeira),
   * executando uma instrução com `trecho`. Não depende de tempo: falha se em
   * 10 s isso não acontecer (a trava não existe). */
  async function esperarBloqueadas(pid: number, trecho: string, quantas = 1) {
    const limite = Date.now() + 10_000;
    for (;;) {
      const esperando = (await db.query(
        `SELECT pid, query, pg_blocking_pids(pid) AS por FROM pg_stat_activity WHERE wait_event_type = 'Lock'`,
      )) as { pid: number; query: string; por: number[] }[];
      const causadas = new Set([pid]);
      for (let mudou = true; mudou; ) {
        mudou = false;
        for (const e of esperando) {
          if (!causadas.has(e.pid) && e.por.some((p) => causadas.has(p))) {
            causadas.add(e.pid);
            mudou = true;
          }
        }
      }
      const bloqueadas = esperando.filter((e) => e.pid !== pid && causadas.has(e.pid));
      if (bloqueadas.filter((b) => b.query.includes(trecho)).length >= quantas) return;
      if (Date.now() > limite) {
        throw new Error(`Esperava ${quantas} sessão(ões) bloqueada(s) por ${pid} em "${trecho}": ${JSON.stringify(bloqueadas)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('profissional anterior à regra geral (sem configuração gravada): recebe, sem regra geral, "não configurada" sem valor', async () => {
    const c = await cenario('legado');
    await db.query('DELETE FROM professional_commission_settings WHERE tenant_id = $1', [c.tenantId]);
    const vista = await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, pct(4000));
    expect(vista.settings).toEqual({ receivesCommission: true, defaultRule: null });
    expect(vista.services.map((s) => [s.service.name, s.effective])).toEqual([
      ['Avaliação', { source: null, rule: null }],
      ['Barba', { source: null, rule: null }],
      ['Corte', { source: 'SERVICE', rule: pct(4000) }],
    ]);
    // Mudar uma exceção não grava configuração: continua no estado anterior.
    expect((await db.query('SELECT count(*)::int AS n FROM professional_commission_settings WHERE tenant_id = $1', [c.tenantId])) as { n: number }[]).toEqual([
      { n: 0 },
    ]);
    expect((await comissoes.settingsSummary(c.dono, c.tenantId)).professionals).toEqual(
      expect.arrayContaining([
        { professionalId: c.ana, receivesCommission: true },
        { professionalId: c.bia, receivesCommission: true },
      ]),
    );
    const reserva = await reservar(c, [c.corte, c.barba], as(DIA, 9));
    await concluir(c, reserva.id, as(DIA, 9));
    expect((await linhas(reserva.id)).map(resumo)).toEqual([
      [c.corte, 'SERVICE', 'PERCENTAGE', 4000, 1700],
      [c.barba, null, null, null, null],
    ]);
    // Apuração gravada antes da regra geral (escopo NULL com regra): no
    // relatório, regra antiga por serviço, nunca "exceção"; sem regra
    // continua sem origem e em conferência.
    await db.query(`UPDATE commission_entries SET applied_rule_scope = NULL WHERE appointment_id = $1`, [reserva.id]);
    const [atendimento] = (await comissoes.report(c.dono, c.tenantId, MES)).appointments;
    expect(atendimento.items.map((i) => [i.serviceName, i.ruleSource, i.situation])).toEqual([
      ['Corte', 'LEGACY_SERVICE', 'OK'],
      ['Barba', null, 'NAO_CONFIGURADA'],
    ]);
    expect(atendimento.commissionCents).toBe(1700);
  });

  it('profissional novo começa desligado: regras guardadas não geram comissão; religar e repetir a conclusão não é retroativo', async () => {
    const c = await cenario('novo');
    const carla = await profissionais.create(c.dono, c.tenantId, { name: 'Carla novo', serviceIds: [c.corte, c.barba] });
    await horarios.replace(c.dono, c.tenantId, carla.id, { days: [{ weekday: WEEKDAY, intervals: [{ start: '08:00', end: '20:00' }] }] });
    const regras = await comissoes.setRule(c.dono, c.tenantId, carla.id, c.corte, pct(4000));
    expect(regras.settings).toEqual({ receivesCommission: false, defaultRule: null });
    // A tela mostra o que valeria; quem decide se gera é "Recebe comissão".
    expect(regras.services.find((s) => s.service.id === c.corte)!.effective).toEqual({ source: 'SERVICE', rule: pct(4000) });
    expect((await comissoes.settingsSummary(c.dono, c.tenantId)).professionals).toEqual(
      expect.arrayContaining([{ professionalId: carla.id, receivesCommission: false }]),
    );

    const desligada = await reservar(c, [c.corte, c.barba], as(DIA, 9), carla.id);
    await concluir(c, desligada.id, as(DIA, 9));
    expect(await contar(desligada.id)).toBe(0);

    const ligada = await comissoes.setSettings(c.dono, c.tenantId, carla.id, { receivesCommission: true, defaultRule: fixo(1000) });
    expect(ligada.settings).toEqual({ receivesCommission: true, defaultRule: fixo(1000) });
    // Repetir a conclusão do atendimento feito com ela desligada não apura.
    await concluir(c, desligada.id, as(DIA, 9));
    expect(await contar(desligada.id)).toBe(0);
    expect(await total(c)).toBe(0);

    const depois = await reservar(c, [c.corte, c.barba], as(DIA, 10), carla.id);
    await concluir(c, depois.id, as(DIA, 10));
    const apuradas = (await linhas(depois.id)).map(resumo);
    expect(apuradas).toEqual([
      [c.corte, 'SERVICE', 'PERCENTAGE', 4000, 1700],
      [c.barba, 'DEFAULT', 'FIXED', 1000, 1000],
    ]);

    // Desligar guarda regra geral e exceções, não mexe no histórico e
    // impede apuração nova.
    const off = await comissoes.setSettings(c.dono, c.tenantId, carla.id, { receivesCommission: false, defaultRule: fixo(1000) });
    expect(off.settings).toEqual({ receivesCommission: false, defaultRule: fixo(1000) });
    expect(off.services.find((s) => s.service.id === c.corte)!.rule).toEqual(pct(4000));
    const deNovoDesligada = await reservar(c, [c.corte], as(DIA, 11), carla.id);
    await concluir(c, deNovoDesligada.id, as(DIA, 11));
    expect(await contar(deNovoDesligada.id)).toBe(0);
    expect((await linhas(depois.id)).map(resumo)).toEqual(apuradas);
    expect(await total(c)).toBe(2700);

    const auditoria = (await db.query(
      `SELECT summary FROM audit_logs WHERE tenant_id = $1 AND action = 'COMMISSION_RULE_CHANGED' AND summary LIKE 'Comissão de Carla novo:%'
        ORDER BY occurred_at, id`,
      [c.tenantId],
    )) as { summary: string }[];
    expect(auditoria.map((a) => a.summary)).toEqual([
      'Comissão de Carla novo: não recebe → recebe, regra geral R$ 10.00 fixo.',
      'Comissão de Carla novo: recebe, regra geral R$ 10.00 fixo → não recebe.',
    ]);
    // Repetir a mesma configuração não grava nem audita.
    await comissoes.setSettings(c.dono, c.tenantId, carla.id, { receivesCommission: false, defaultRule: fixo(1000) });
    expect(
      ((await db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND summary LIKE 'Comissão de Carla novo:%'`, [
        c.tenantId,
      ])) as { n: number }[])[0].n,
    ).toBe(2);
  });

  it('precedência da apuração = a mostrada na tela: exceção (inclusive "sem comissão") > regra geral; fixo por serviço realizado', async () => {
    const c = await cenario('precedencia');
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: fixo(1000) });
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, pct(1000));
    const vista = await comissoes.setRule(c.dono, c.tenantId, c.ana, c.barba, { kind: 'NONE' });
    const reserva = await reservar(c, [c.corte, c.barba, c.avaliacao], as(DIA, 9));
    await concluir(c, reserva.id, as(DIA, 9));
    const apuradas = await linhas(reserva.id);
    for (const linha of apuradas) {
      const naTela = vista.services.find((s) => s.service.id === linha.service_id)!.effective;
      expect([linha.applied_rule_scope, linha.applied_type, linha.applied_value]).toEqual([
        naTela.source,
        naTela.rule ? (naTela.rule.kind === 'NONE' ? 'PERCENTAGE' : naTela.rule.kind) : null,
        naTela.rule ? (naTela.rule.value ?? 0) : null,
      ]);
    }
    // 10% de 42,50; "sem comissão" na Barba; R$ 10 fixos na Avaliação, sob consulta.
    expect(apuradas.map((l) => [l.service_id, l.applied_rule_scope, l.professional_cents, l.establishment_cents])).toEqual([
      [c.corte, 'SERVICE', 425, 3825],
      [c.barba, 'SERVICE', 0, 2500],
      [c.avaliacao, 'DEFAULT', 1000, null],
    ]);
    const [atendimento] = (await comissoes.report(c.dono, c.tenantId, MES)).appointments;
    expect(atendimento.items.map((i) => i.ruleSource)).toEqual(['SERVICE', 'SERVICE', 'DEFAULT']);
    expect(atendimento.commissionCents).toBe(1425);

    // Mudar a regra geral e remover uma exceção depois não recalcula.
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: pct(5000) });
    const semExcecao = await comissoes.clearRule(c.dono, c.tenantId, c.ana, c.corte);
    expect(semExcecao.services.find((s) => s.service.id === c.corte)).toMatchObject({
      rule: null,
      effective: { source: 'DEFAULT', rule: pct(5000) },
    });
    expect(await linhas(reserva.id)).toEqual(apuradas);
    expect(await total(c)).toBe(1425);
  });

  it('mudanças simultâneas às conclusões: cada apuração usa uma configuração que existiu inteira', async () => {
    const c = await cenario('concorrencia');
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: fixo(1000) });
    const inicios = [8, 9, 10, 11, 12, 13, 14, 15].map((h) => as(DIA, h));
    const reservas = [];
    for (const inicio of inicios) reservas.push(await reservar(c, [c.corte, c.barba], inicio));
    relogio = DEPOIS;
    // Estados que existiram, em ordem: A {geral R$ 10}; B {geral 50%};
    // C {geral 50%, Barba sem comissão}. Uma leitura com a configuração de A e
    // a exceção de C misturaria os dois e é proibida.
    const mudancas = (async () => {
      await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: pct(5000) });
      await comissoes.setRule(c.dono, c.tenantId, c.ana, c.barba, { kind: 'NONE' });
    })();
    await Promise.all([
      mudancas,
      ...reservas.map((r, i) => agendamentos.changeStatus(c.dono, c.tenantId, r.id, 'complete', { expectedStartAt: inicios[i] })),
    ]);
    const validos = [
      JSON.stringify([[c.corte, 'DEFAULT', 'FIXED', 1000, 1000], [c.barba, 'DEFAULT', 'FIXED', 1000, 1000]]),
      JSON.stringify([[c.corte, 'DEFAULT', 'PERCENTAGE', 5000, 2125], [c.barba, 'DEFAULT', 'PERCENTAGE', 5000, 1250]]),
      JSON.stringify([[c.corte, 'DEFAULT', 'PERCENTAGE', 5000, 2125], [c.barba, 'SERVICE', 'PERCENTAGE', 0, 0]]),
    ];
    for (const r of reservas) expect(validos).toContain(JSON.stringify((await linhas(r.id)).map(resumo)));

    // Desligar durante conclusões: cada atendimento tem todas as linhas ou nenhuma.
    const outras = [];
    for (const h of [16, 17, 18, 19]) outras.push({ r: await reservar(c, [c.corte, c.barba], as(DIA, h)), inicio: as(DIA, h) });
    relogio = DEPOIS;
    await Promise.all([
      comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: false, defaultRule: pct(5000) }),
      ...outras.map(({ r, inicio }) => agendamentos.changeStatus(c.dono, c.tenantId, r.id, 'complete', { expectedStartAt: inicio })),
    ]);
    for (const { r } of outras) expect([0, 2]).toContain(await contar(r.id));
  });

  it('a conclusão espera uma mudança de configuração em curso e apura com a configuração inteira de depois', async () => {
    const c = await cenario('trava');
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: fixo(1000) });
    const inicio = as(DIA, 9);
    const reserva = await reservar(c, [c.corte, c.barba], inicio);
    // Uma mudança em curso, como a de `setSettings`/`setRule`: trava o
    // profissional e grava a regra geral e uma exceção, ainda sem commit.
    const mudanca = db.createQueryRunner();
    await mudanca.connect();
    await mudanca.startTransaction();
    let terminou = false;
    try {
      const [{ pid }] = (await mudanca.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[];
      await mudanca.query('SELECT 1 FROM professionals WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [c.tenantId, c.ana]);
      await mudanca.query(
        `UPDATE professional_commission_settings SET default_type = 'PERCENTAGE', default_value = 5000 WHERE tenant_id = $1 AND professional_id = $2`,
        [c.tenantId, c.ana],
      );
      relogio = DEPOIS;
      const conclusao = agendamentos.changeStatus(c.dono, c.tenantId, reserva.id, 'complete', { expectedStartAt: inicio }).then(() => {
        terminou = true;
      });
      // A conclusão está parada na trava da apuração (`FOR KEY SHARE` no
      // profissional) que esta mudança segura; só então a mudança termina.
      await esperarBloqueadas(pid, 'FOR KEY SHARE');
      expect(terminou).toBe(false);
      await mudanca.query(
        `INSERT INTO commission_rules (id, tenant_id, professional_id, service_id, type, value, created_at, updated_at)
         VALUES (substr(md5(random()::text), 1, 24), $1, $2, $3, 'PERCENTAGE', 0, now(), now())`,
        [c.tenantId, c.ana, c.barba],
      );
      await mudanca.commitTransaction();
      await conclusao;
    } finally {
      if (mudanca.isTransactionActive) await mudanca.rollbackTransaction();
      await mudanca.release();
    }
    expect(terminou).toBe(true);
    expect((await linhas(reserva.id)).map(resumo)).toEqual([
      [c.corte, 'DEFAULT', 'PERCENTAGE', 5000, 2125],
      [c.barba, 'SERVICE', 'PERCENTAGE', 0, 0],
    ]);
  });

  it('mudanças de configuração e de exceção esperam a apuração em curso, que termina com a configuração de antes', async () => {
    const c = await cenario('trava-inversa');
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: fixo(1000) });
    const antes = { receivesCommission: true, defaultRule: { type: 'FIXED', value: 1000 } };
    const excecoes = async (manager: { query: (sql: string, p: unknown[]) => Promise<unknown> }) =>
      (await manager.query('SELECT count(*)::int AS n FROM commission_rules WHERE tenant_id = $1 AND professional_id = $2', [
        c.tenantId,
        c.ana,
      ])) as { n: number }[];
    // Uma apuração em curso: já travou o profissional e leu a configuração
    // (a mesma função de `apurarNaConclusao`), ainda sem commit.
    const apuracao = db.createQueryRunner();
    await apuracao.connect();
    await apuracao.startTransaction();
    let mudou = false;
    let mudancas: Promise<void> | undefined;
    try {
      const [{ pid }] = (await apuracao.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[];
      expect(await configuracaoTravada(apuracao.manager, c.tenantId, c.ana)).toEqual(antes);
      mudancas = Promise.all([
        comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: false, defaultRule: null }),
        comissoes.setRule(c.dono, c.tenantId, c.ana, c.barba, { kind: 'NONE' }),
      ]).then(() => {
        mudou = true;
      });
      // As duas mudanças estão paradas no `FOR UPDATE` do profissional.
      await esperarBloqueadas(pid, 'FOR UPDATE', 2);
      expect(mudou).toBe(false);
      // Enquanto isso, a apuração continua vendo só a configuração de antes.
      expect(await configuracaoTravada(apuracao.manager, c.tenantId, c.ana)).toEqual(antes);
      expect(await excecoes(apuracao.manager)).toEqual([{ n: 0 }]);
      await apuracao.commitTransaction();
      await mudancas;
    } finally {
      if (apuracao.isTransactionActive) await apuracao.rollbackTransaction();
      await apuracao.release();
      await mudancas?.catch(() => undefined);
    }
    expect(mudou).toBe(true);
    expect(await configuracaoTravada(db.manager, c.tenantId, c.ana)).toEqual({ receivesCommission: false, defaultRule: null });
    expect(await excecoes(db.manager)).toEqual([{ n: 1 }]);
  });

  it('reabertura futura: com o profissional desligado a fotografia fica revertida; religado, volta a MESMA, sem recalcular', async () => {
    const c = await cenario('reativacao');
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: fixo(1000) });
    const feita = await reservar(c, [c.corte, c.barba], as(DIA, 9));
    await concluir(c, feita.id, as(DIA, 9));
    const fotografia = (await linhas(feita.id)).map(resumo);
    expect(fotografia).toEqual([
      [c.corte, 'DEFAULT', 'FIXED', 1000, 1000],
      [c.barba, 'DEFAULT', 'FIXED', 1000, 1000],
    ]);
    const reabrir = () =>
      db.transaction(async (m) => {
        await m.query(`UPDATE appointments SET status = 'IN_PROGRESS' WHERE id = $1`, [feita.id]);
        await reverterApuracao(m, { tenantId: c.tenantId, id: feita.id }, DEPOIS);
      });
    await reabrir();
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: false, defaultRule: fixo(1000) });
    await concluir(c, feita.id, as(DIA, 9));
    expect((await linhas(feita.id)).map((l) => l.status)).toEqual(['REVERSED', 'REVERSED']);
    expect(await contar(feita.id)).toBe(2);
    expect(await total(c)).toBe(0);

    await reabrir();
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: pct(5000) });
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'NONE' });
    await concluir(c, feita.id, as(DIA, 9));
    const reativadas = await linhas(feita.id);
    expect(reativadas.map((l) => l.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    expect(reativadas.map(resumo)).toEqual(fotografia);
    expect(await total(c)).toBe(2000);
  });

  it('configuração: só o dono com a gestão de comissões; funcionário e gerente não alteram nem ligam a própria; isolamento', async () => {
    const c = await cenario('config-acesso');
    const outro = await cenario('config-acesso-outro');
    const ligar = { receivesCommission: true, defaultRule: pct(5000) };
    const funcionarioDaAna = await funcionario(c, c.ana, 'PROFISSIONAL', ['COMISSOES_PROPRIAS_VISUALIZAR']);
    await expect(comissoes.setSettings(funcionarioDaAna, c.tenantId, c.ana, ligar)).rejects.toThrow(ForbiddenException);
    await expect(comissoes.settingsSummary(funcionarioDaAna, c.tenantId)).rejects.toThrow(ForbiddenException);
    await expect(comissoes.setRule(funcionarioDaAna, c.tenantId, c.ana, c.corte, pct(5000))).rejects.toThrow(ForbiddenException);
    const gerente = await funcionario(c, c.bia, 'GERENTE', ['COMISSOES_PROPRIAS_VISUALIZAR']);
    await expect(comissoes.setSettings(gerente, c.tenantId, c.bia, ligar)).rejects.toThrow(ForbiddenException);
    await db.query(`DELETE FROM memberships WHERE user_id = $1`, [gerente]);
    // Ids cruzados respondem como inexistentes.
    await expect(comissoes.setSettings(c.dono, c.tenantId, outro.ana, ligar)).rejects.toThrow(NotFoundException);
    await expect(comissoes.setSettings(outro.dono, c.tenantId, c.ana, ligar)).rejects.toThrow(NotFoundException);
    await expect(comissoes.settingsSummary(outro.dono, c.tenantId)).rejects.toThrow(NotFoundException);
    expect((await comissoes.settingsSummary(outro.dono, outro.tenantId)).professionals.map((p) => p.professionalId).sort()).toEqual(
      [outro.ana, outro.bia].sort(),
    );
    // Nada foi gravado pelas recusas.
    expect((await comissoes.rules(c.dono, c.tenantId, c.ana)).settings).toEqual({ receivesCommission: true, defaultRule: null });
    // Dono com a configuração restringida.
    const [{ id: membroDono }] = (await db.query('SELECT id FROM memberships WHERE tenant_id = $1 AND user_id = $2', [c.tenantId, c.dono])) as {
      id: string;
    }[];
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       VALUES (substr(md5(random()::text), 1, 24), $1, $2, 'COMISSOES_GERENCIAR', 'DENIED')`,
      [c.tenantId, membroDono],
    );
    await expect(comissoes.setSettings(c.dono, c.tenantId, c.ana, ligar)).rejects.toThrow(ForbiddenException);
    // Básico: sem o recurso, recusado.
    const basico = await cenario('config-basico', 'essencial');
    await expect(comissoes.setSettings(basico.dono, basico.tenantId, basico.ana, ligar)).rejects.toThrow(ForbiddenException);
  });
  // ---------------------------------------------------------------------
  // Aplicação em massa (docs/plans/comissoes-aplicacao-em-massa.md)

  /** Ana: recebe, sem regra geral. Bia: recebe, fixo 15,00. Carla: nova,
   * desligada. Davi: sem linha (anterior à regra geral). Edu: recebe, 10%.
   * Fábio: inativo, fica fora de "Todos". Ana tem a exceção "sem comissão"
   * no Corte. */
  async function cenarioEmMassa(nome: string) {
    const c = await cenario(nome);
    await comissoes.setSettings(c.dono, c.tenantId, c.bia, { receivesCommission: true, defaultRule: fixo(1500) });
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, { kind: 'NONE' });
    const criar = async (n: string) => (await profissionais.create(c.dono, c.tenantId, { name: `${n} ${nome}`, serviceIds: [c.corte] })).id;
    const carla = await criar('Carla');
    const davi = await criar('Davi');
    await db.query('DELETE FROM professional_commission_settings WHERE tenant_id = $1 AND professional_id = $2', [c.tenantId, davi]);
    const edu = await criar('Edu');
    await comissoes.setSettings(c.dono, c.tenantId, edu, { receivesCommission: true, defaultRule: pct(1000) });
    const fabio = await criar('Fábio');
    await db.query('UPDATE professionals SET active = false WHERE tenant_id = $1 AND id = $2', [c.tenantId, fabio]);
    return { ...c, carla, davi, edu, fabio };
  }

  const configuracoes = async (tenantId: string) =>
    (await db.query(
      `SELECT professional_id, receives_commission, default_type::text AS default_type, default_value
         FROM professional_commission_settings WHERE tenant_id = $1 ORDER BY professional_id`,
      [tenantId],
    )) as unknown[];
  const excecoesEApuracoes = async (tenantId: string) => ({
    regras: (await db.query(
      `SELECT row_to_json(r)::text AS l FROM commission_rules r WHERE tenant_id = $1 ORDER BY id`,
      [tenantId],
    )) as unknown[],
    apuradas: (await db.query(
      `SELECT row_to_json(e)::text AS l FROM commission_entries e WHERE tenant_id = $1 ORDER BY id`,
      [tenantId],
    )) as unknown[],
  });
  const auditoriaDaOperacao = async (tenantId: string, operationId: string) =>
    (await db.query(
      `SELECT summary, previous_data, new_data FROM audit_logs
        WHERE tenant_id = $1 AND action = 'COMMISSION_RULE_CHANGED' AND new_data->'bulk'->>'operationId' = $2 ORDER BY summary`,
      [tenantId, operationId],
    )) as { summary: string; previous_data: Record<string, unknown>; new_data: Record<string, unknown> }[];
  const desatualizada = { response: { code: 'PREVIA_DESATUALIZADA' } };
  const porNome = (p: { professionals: { professional: { name: string }; outcome: string }[] }) =>
    Object.fromEntries(p.professionals.map((x) => [x.professional.name.split(' ')[0], x.outcome]));

  it('em massa, PRESERVAR: só quem recebe sem regra geral ganha a regra; exceções, apurações e desligados intactos', async () => {
    const c = await cenarioEmMassa('massa-preservar');
    // Um atendimento já apurado antes: a fotografia não muda.
    const feita = await reservar(c, [c.corte, c.barba], as(DIA, 9));
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: null });
    await concluir(c, feita.id, as(DIA, 9));
    const fotografia = (await linhas(feita.id)).map(resumo);
    const pedido = { target: 'ALL' as const, defaultRule: pct(1000), mode: 'PRESERVE' as const };

    const previa = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
    expect(porNome(previa)).toEqual({ Ana: 'CHANGE', Bia: 'PRESERVE', Carla: 'PRESERVE', Davi: 'CHANGE', Edu: 'UNCHANGED' });
    expect(previa.summary).toEqual({ change: 2, preserve: 2, unchanged: 1, total: 5, exceptionsRemoved: 0 });
    const carla = previa.professionals.find((p) => p.professional.id === c.carla);
    expect(carla).toMatchObject({ current: { receivesCommission: false, defaultRule: null }, next: { receivesCommission: false, defaultRule: null } });
    // A prévia não grava nada.
    const antesDaAplicacao = await configuracoes(c.tenantId);
    const intactas = await excecoesEApuracoes(c.tenantId);
    expect(await configuracoes(c.tenantId)).toEqual(antesDaAplicacao);

    const aplicada = await comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint: previa.fingerprint });
    expect(aplicada).toMatchObject({ applied: true, summary: previa.summary, professionals: previa.professionals });
    const depois = await comissoes.settingsSummary(c.dono, c.tenantId);
    expect(Object.fromEntries(depois.professionals.map((p) => [p.professionalId, p.receivesCommission]))).toMatchObject({
      [c.ana]: true,
      [c.bia]: true,
      [c.carla]: false,
      [c.davi]: true,
      [c.edu]: true,
      [c.fabio]: false,
    });
    expect((await comissoes.rules(c.dono, c.tenantId, c.bia)).settings.defaultRule).toEqual(fixo(1500));
    expect((await comissoes.rules(c.dono, c.tenantId, c.davi)).settings).toEqual({ receivesCommission: true, defaultRule: pct(1000) });
    // A exceção da Ana continua valendo antes da regra geral nova.
    const regrasDaAna = await comissoes.rules(c.dono, c.tenantId, c.ana);
    expect(regrasDaAna.services.map((s) => [s.service.name, s.effective])).toEqual([
      ['Avaliação', { source: 'DEFAULT', rule: pct(1000) }],
      ['Barba', { source: 'DEFAULT', rule: pct(1000) }],
      ['Corte', { source: 'SERVICE', rule: { kind: 'NONE', value: null } }],
    ]);
    // Exceções e apurações não mudaram; o histórico guarda a fotografia.
    expect(await excecoesEApuracoes(c.tenantId)).toEqual(intactas);
    expect((await linhas(feita.id)).map(resumo)).toEqual(fotografia);
    // A conclusão seguinte usa a precedência de sempre.
    const nova = await reservar(c, [c.corte, c.barba], as(OUTRO_DIA, 9));
    await concluir(c, nova.id, as(OUTRO_DIA, 9));
    expect((await linhas(nova.id)).map(resumo)).toEqual([
      [c.corte, 'SERVICE', 'PERCENTAGE', 0, 0],
      [c.barba, 'DEFAULT', 'PERCENTAGE', 1000, 250],
    ]);
    // Um registro por profissional alterado, agrupado pela operação.
    const auditoria = await auditoriaDaOperacao(c.tenantId, aplicada.operationId);
    expect(auditoria.map((a) => a.summary)).toEqual([
      'Comissão de Ana massa-preservar (aplicação em massa, preservar): recebe, regra geral não definida → recebe, regra geral 10.00%.',
      'Comissão de Davi massa-preservar (aplicação em massa, preservar): recebe, regra geral não definida → recebe, regra geral 10.00%.',
    ]);
    expect(auditoria[0].new_data).toEqual({
      professionalId: c.ana,
      settings: { receivesCommission: true, defaultRule: pct(1000) },
      bulk: { operationId: aplicada.operationId, mode: 'PRESERVE', exceptions: 'KEEP' },
    });
    // Repetir a mesma aplicação (rede caiu): 409, nada muda, e a prévia nova
    // mostra tudo como já está.
    const gravadas = await configuracoes(c.tenantId);
    await expect(comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint: previa.fingerprint })).rejects.toMatchObject(
      desatualizada,
    );
    expect(await configuracoes(c.tenantId)).toEqual(gravadas);
    expect((await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido)).summary).toEqual({ change: 0, preserve: 2, unchanged: 3, total: 5, exceptionsRemoved: 0 });
  });

  it('em massa, SUBSTITUIR: troca a regra geral e liga "Recebe comissão" de todos os ativos; exceções intactas', async () => {
    const c = await cenarioEmMassa('massa-substituir');
    const pedido = { target: 'ALL' as const, defaultRule: pct(1000), mode: 'REPLACE' as const };
    const intactas = await excecoesEApuracoes(c.tenantId);
    const previa = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
    expect(porNome(previa)).toEqual({ Ana: 'CHANGE', Bia: 'CHANGE', Carla: 'CHANGE', Davi: 'CHANGE', Edu: 'UNCHANGED' });
    expect(previa.professionals.every((p) => p.next.receivesCommission && p.next.defaultRule?.value === 1000)).toBe(true);
    const aplicada = await comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint: previa.fingerprint, confirmReplace: true });
    expect(aplicada.summary).toEqual({ change: 4, preserve: 0, unchanged: 1, total: 5, exceptionsRemoved: 0 });
    for (const id of [c.ana, c.bia, c.carla, c.davi, c.edu]) {
      expect((await comissoes.rules(c.dono, c.tenantId, id)).settings).toEqual({ receivesCommission: true, defaultRule: pct(1000) });
    }
    // O inativo ficou de fora: desligado, como estava.
    expect((await comissoes.rules(c.dono, c.tenantId, c.fabio)).settings).toEqual({ receivesCommission: false, defaultRule: null });
    expect(await excecoesEApuracoes(c.tenantId)).toEqual(intactas);
    const auditoria = await auditoriaDaOperacao(c.tenantId, aplicada.operationId);
    expect(auditoria).toHaveLength(4);
    expect(auditoria.find((a) => a.summary.startsWith('Comissão de Carla'))?.summary).toBe(
      'Comissão de Carla massa-substituir (aplicação em massa, substituir): não recebe → recebe, regra geral 10.00%.',
    );
    expect(auditoria.find((a) => a.summary.startsWith('Comissão de Bia'))?.previous_data).toEqual({
      professionalId: c.bia,
      settings: { receivesCommission: true, defaultRule: fixo(1500) },
    });

    // Escolhidos: só os da lista; inativo escolhido é recusado.
    const escolhidos = { target: 'SELECTED' as const, professionalIds: [c.bia, c.davi], defaultRule: fixo(2000), mode: 'REPLACE' as const };
    const parcial = await comissoes.previewBulkSettings(c.dono, c.tenantId, escolhidos);
    expect(porNome(parcial)).toEqual({ Bia: 'CHANGE', Davi: 'CHANGE' });
    await comissoes.applyBulkSettings(c.dono, c.tenantId, { ...escolhidos, fingerprint: parcial.fingerprint, confirmReplace: true });
    expect((await comissoes.rules(c.dono, c.tenantId, c.ana)).settings.defaultRule).toEqual(pct(1000));
    expect((await comissoes.rules(c.dono, c.tenantId, c.bia)).settings.defaultRule).toEqual(fixo(2000));
    await expect(
      comissoes.previewBulkSettings(c.dono, c.tenantId, { ...escolhidos, professionalIds: [c.ana, c.fabio] }),
    ).rejects.toMatchObject({ response: { code: 'PROFISSIONAL_INATIVO' } });
  });

  it('em massa: prévia desatualizada (configuração, alcance ou pedido) responde 409 e não grava nada', async () => {
    const c = await cenarioEmMassa('massa-409');
    const pedido = { target: 'ALL' as const, defaultRule: pct(1000), mode: 'PRESERVE' as const };
    const previa = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
    // Configuração de um profissional mudou depois da prévia.
    await comissoes.setSettings(c.dono, c.tenantId, c.bia, { receivesCommission: true, defaultRule: null });
    const gravadas = await configuracoes(c.tenantId);
    await expect(comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint: previa.fingerprint })).rejects.toMatchObject(
      desatualizada,
    );
    expect(await configuracoes(c.tenantId)).toEqual(gravadas);
    // Alcance mudou: um profissional reativado entra em "Todos".
    const segunda = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
    await db.query('UPDATE professionals SET active = true WHERE id = $1', [c.fabio]);
    await expect(comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint: segunda.fingerprint })).rejects.toMatchObject(
      desatualizada,
    );
    // A impressão é do pedido: outra regra ou outro modo não usa a prévia.
    const terceira = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
    await expect(
      comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, defaultRule: pct(1100), fingerprint: terceira.fingerprint }),
    ).rejects.toMatchObject(desatualizada);
    await expect(
      comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, mode: 'REPLACE', confirmReplace: true, fingerprint: terceira.fingerprint }),
    ).rejects.toMatchObject(desatualizada);
    expect(await configuracoes(c.tenantId)).toEqual(gravadas);
    // Com a prévia certa, aplica.
    await comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint: terceira.fingerprint });
    expect((await comissoes.rules(c.dono, c.tenantId, c.bia)).settings.defaultRule).toEqual(pct(1000));
  });

  it('em massa: duas aplicações simultâneas da mesma prévia, uma aplica e a outra recebe 409', async () => {
    const c = await cenarioEmMassa('massa-paralela');
    const pedido = { target: 'ALL' as const, defaultRule: pct(1000), mode: 'REPLACE' as const, confirmReplace: true as const };
    const { fingerprint } = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
    const resultados = await Promise.allSettled([
      comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint }),
      comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint }),
    ]);
    expect(resultados.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(resultados.find((r) => r.status === 'rejected')).toMatchObject({ reason: desatualizada });
    const operacao = (resultados.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ operationId: string }>).value.operationId;
    expect(await auditoriaDaOperacao(c.tenantId, operacao)).toHaveLength(4);
    expect(
      ((await db.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND new_data->'bulk' IS NOT NULL`,
        [c.tenantId],
      )) as { n: number }[])[0].n,
    ).toBe(4);
  });

  it('em massa: a aplicação espera a apuração em curso e uma mudança individual em curso a torna desatualizada', async () => {
    const c = await cenarioEmMassa('massa-trava');
    const pedido = { target: 'ALL' as const, defaultRule: pct(1000), mode: 'REPLACE' as const, confirmReplace: true as const };
    // Apuração em curso: travou a Ana (FOR KEY SHARE) e leu a configuração.
    const apuracao = db.createQueryRunner();
    await apuracao.connect();
    await apuracao.startTransaction();
    let aplicou = false;
    let aplicacao: Promise<unknown> | undefined;
    try {
      const [{ pid }] = (await apuracao.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[];
      const antes = await configuracaoTravada(apuracao.manager, c.tenantId, c.ana);
      const { fingerprint } = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
      aplicacao = comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint }).then(() => {
        aplicou = true;
      });
      await esperarBloqueadas(pid, 'FOR UPDATE');
      expect(aplicou).toBe(false);
      // A apuração continua vendo a configuração de antes, inteira.
      expect(await configuracaoTravada(apuracao.manager, c.tenantId, c.ana)).toEqual(antes);
      await apuracao.commitTransaction();
      await aplicacao;
    } finally {
      if (apuracao.isTransactionActive) await apuracao.rollbackTransaction();
      await apuracao.release();
      await aplicacao?.catch(() => undefined);
    }
    expect(aplicou).toBe(true);

    // Mudança individual em curso (`setSettings` travou a Bia): a aplicação
    // espera e, como a configuração mudou, recusa com 409 sem gravar.
    const segundo = { ...pedido, defaultRule: fixo(1200) };
    const { fingerprint } = await comissoes.previewBulkSettings(c.dono, c.tenantId, segundo);
    const mudanca = db.createQueryRunner();
    await mudanca.connect();
    await mudanca.startTransaction();
    let recusa: Promise<unknown> | undefined;
    try {
      const [{ pid }] = (await mudanca.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[];
      await mudanca.query('SELECT 1 FROM professionals WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [c.tenantId, c.bia]);
      await mudanca.query(
        `UPDATE professional_commission_settings SET receives_commission = false WHERE tenant_id = $1 AND professional_id = $2`,
        [c.tenantId, c.bia],
      );
      recusa = comissoes.applyBulkSettings(c.dono, c.tenantId, { ...segundo, fingerprint });
      recusa.catch(() => undefined);
      await esperarBloqueadas(pid, 'FOR UPDATE');
      await mudanca.commitTransaction();
      await expect(recusa).rejects.toMatchObject(desatualizada);
    } finally {
      if (mudanca.isTransactionActive) await mudanca.rollbackTransaction();
      await mudanca.release();
    }
    expect((await comissoes.rules(c.dono, c.tenantId, c.ana)).settings.defaultRule).toEqual(pct(1000));
    expect((await comissoes.rules(c.dono, c.tenantId, c.bia)).settings).toEqual({ receivesCommission: false, defaultRule: pct(1000) });
  });

  it('em massa: 200 profissionais numa operação; 201 ativos em "Todos" é recusado', async () => {
    const c = await cenario('massa-200');
    // Ana e Bia + 198 fictícios = 200 ativos (inseridos direto: o limite do
    // plano é do cadastro, não desta rota).
    await db.query(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color, active)
       SELECT 'm200' || $2 || lpad(g::text, 3, '0'), $1, 'Fictício ' || lpad(g::text, 3, '0'), 'FI', '#888888', true
         FROM generate_series(1, 198) AS g`,
      [c.tenantId, sufixo.slice(-8)],
    );
    const pedido = { target: 'ALL' as const, defaultRule: fixo(1000), mode: 'PRESERVE' as const };
    const previa = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
    expect(previa.summary).toEqual({ change: 200, preserve: 0, unchanged: 0, total: 200, exceptionsRemoved: 0 });
    const aplicada = await comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint: previa.fingerprint });
    expect(aplicada.summary.change).toBe(200);
    expect(await auditoriaDaOperacao(c.tenantId, aplicada.operationId)).toHaveLength(200);
    expect(
      ((await db.query(
        `SELECT count(*)::int AS n FROM professional_commission_settings WHERE tenant_id = $1 AND receives_commission AND default_type = 'FIXED' AND default_value = 1000`,
        [c.tenantId],
      )) as { n: number }[])[0].n,
    ).toBe(200);
    // Os mesmos 200 escolhidos um a um também cabem.
    const ids = ((await db.query('SELECT id FROM professionals WHERE tenant_id = $1', [c.tenantId])) as { id: string }[]).map((l) => l.id);
    expect((await comissoes.previewBulkSettings(c.dono, c.tenantId, { ...pedido, target: 'SELECTED', professionalIds: ids })).summary.unchanged).toBe(200);
    // Um ativo a mais: "Todos" recusa e pede partes.
    await db.query(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color, active) VALUES ($1, $2, 'Fictício 201', 'FI', '#888888', true)`,
      [`m201${sufixo.slice(-8)}`, c.tenantId],
    );
    await expect(comissoes.previewBulkSettings(c.dono, c.tenantId, pedido)).rejects.toMatchObject({
      response: { code: 'LIMITE_DA_APLICACAO_EM_MASSA' },
    });
  }, 60_000);

  it('em massa: só o dono com a gestão de comissões; ids de outro estabelecimento como inexistentes; nada gravado', async () => {
    const c = await cenario('massa-acesso');
    const outro = await cenario('massa-acesso-outro');
    const pedido = { target: 'ALL' as const, defaultRule: pct(1000), mode: 'PRESERVE' as const };
    const { fingerprint } = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
    const antes = { c: await configuracoes(c.tenantId), outro: await configuracoes(outro.tenantId) };
    const funcionarioDaAna = await funcionario(c, c.ana, 'PROFISSIONAL', ['COMISSOES_PROPRIAS_VISUALIZAR']);
    await expect(comissoes.previewBulkSettings(funcionarioDaAna, c.tenantId, pedido)).rejects.toThrow(ForbiddenException);
    await expect(comissoes.applyBulkSettings(funcionarioDaAna, c.tenantId, { ...pedido, fingerprint })).rejects.toThrow(ForbiddenException);
    // Dono de outro estabelecimento: o mesmo 404 de inexistente.
    await expect(comissoes.previewBulkSettings(outro.dono, c.tenantId, pedido)).rejects.toThrow(NotFoundException);
    await expect(comissoes.applyBulkSettings(outro.dono, c.tenantId, { ...pedido, fingerprint })).rejects.toThrow(NotFoundException);
    // Profissional de outro estabelecimento na lista: inexistente.
    const misturado = { ...pedido, target: 'SELECTED' as const, professionalIds: [c.ana, outro.ana] };
    await expect(comissoes.previewBulkSettings(c.dono, c.tenantId, misturado)).rejects.toThrow(NotFoundException);
    await expect(comissoes.applyBulkSettings(c.dono, c.tenantId, { ...misturado, fingerprint })).rejects.toThrow(NotFoundException);
    // Básico: sem o recurso.
    const basico = await cenario('massa-basico', 'essencial');
    await expect(comissoes.previewBulkSettings(basico.dono, basico.tenantId, pedido)).rejects.toThrow(ForbiddenException);
    // Dono com a gestão de comissões negada.
    const [{ id: membroDono }] = (await db.query('SELECT id FROM memberships WHERE tenant_id = $1 AND user_id = $2', [c.tenantId, c.dono])) as {
      id: string;
    }[];
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       VALUES (substr(md5(random()::text), 1, 24), $1, $2, 'COMISSOES_GERENCIAR', 'DENIED')`,
      [c.tenantId, membroDono],
    );
    await expect(comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint })).rejects.toThrow(ForbiddenException);
    expect({ c: await configuracoes(c.tenantId), outro: await configuracoes(outro.tenantId) }).toEqual(antes);
  });

  // ---------------------------------------------------------------------
  // Exceções por serviço diante da regra geral: manter (padrão) ou remover,
  // na edição individual e na aplicação em massa (só SUBSTITUIR).

  const regrasDe = async (tenantId: string, professionalId: string) =>
    (await db.query(
      `SELECT service_id, type::text AS type, value FROM commission_rules WHERE tenant_id = $1 AND professional_id = $2 ORDER BY service_id`,
      [tenantId, professionalId],
    )) as unknown[];
  const efetivas = async (c: Cenario, professionalId: string) =>
    Object.fromEntries((await comissoes.rules(c.dono, c.tenantId, professionalId)).services.map((s) => [s.service.name, s.effective]));
  const excecoesDesatualizadas = { response: { code: 'EXCECOES_DESATUALIZADAS' } };
  const auditoriasDe = async (tenantId: string, professionalId: string) =>
    (await db.query(
      `SELECT summary, previous_data, new_data FROM audit_logs
        WHERE tenant_id = $1 AND action = 'COMMISSION_RULE_CHANGED' AND new_data->>'professionalId' = $2 ORDER BY occurred_at, id`,
      [tenantId, professionalId],
    )) as { summary: string; previous_data: Record<string, unknown>; new_data: Record<string, unknown> }[];

  it('individual: Ana Luiza 20% com exceção de 15% na barba; manter dá 15% na barba, remover dá 20%; histórico intacto', async () => {
    const c = await cenario('excecoes-individual');
    const outro = await cenario('excecoes-individual-outro');
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: pct(2000) });
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.barba, pct(1500));
    await comissoes.setRule(c.dono, c.tenantId, c.bia, c.corte, pct(3000));
    await comissoes.setRule(outro.dono, outro.tenantId, outro.ana, outro.barba, pct(1500));
    const daBia = await regrasDe(c.tenantId, c.bia);
    const doOutro = await regrasDe(outro.tenantId, outro.ana);

    // Manter (o padrão, inclusive explícito): salvar a regra geral não remove
    // a exceção, e a barba continua em 15%.
    await comissoes.setSettings(c.dono, c.tenantId, c.ana, { receivesCommission: true, defaultRule: pct(2000), exceptions: 'KEEP' });
    expect(await efetivas(c, c.ana)).toMatchObject({
      Barba: { source: 'SERVICE', rule: pct(1500) },
      Corte: { source: 'DEFAULT', rule: pct(2000) },
    });
    const mantida = await reservar(c, [c.corte, c.barba], as(DIA, 9));
    await concluir(c, mantida.id, as(DIA, 9));
    const fotografia = (await linhas(mantida.id)).map(resumo);
    expect(fotografia).toEqual([
      [c.corte, 'DEFAULT', 'PERCENTAGE', 2000, 850],
      [c.barba, 'SERVICE', 'PERCENTAGE', 1500, 375],
    ]);

    // Uma exceção muda depois da leitura: a remoção é recusada sem gravar.
    const lida = await comissoes.rules(c.dono, c.tenantId, c.ana);
    expect(lida.exceptionsFingerprint).toMatch(/^[0-9a-f]{64}$/);
    await comissoes.setRule(c.dono, c.tenantId, c.ana, c.corte, fixo(500));
    const remover = (exceptionsFingerprint: string) => ({
      receivesCommission: true,
      defaultRule: pct(2000),
      exceptions: 'REMOVE' as const,
      exceptionsFingerprint,
      confirmRemoveExceptions: true as const,
    });
    const antes = await regrasDe(c.tenantId, c.ana);
    await expect(comissoes.setSettings(c.dono, c.tenantId, c.ana, remover(lida.exceptionsFingerprint))).rejects.toMatchObject(
      excecoesDesatualizadas,
    );
    expect(await regrasDe(c.tenantId, c.ana)).toEqual(antes);

    // Permissão e isolamento continuam os mesmos.
    const atual = await comissoes.rules(c.dono, c.tenantId, c.ana);
    const funcionarioDaAna = await funcionario(c, c.ana, 'PROFISSIONAL', ['COMISSOES_PROPRIAS_VISUALIZAR']);
    await expect(comissoes.setSettings(funcionarioDaAna, c.tenantId, c.ana, remover(atual.exceptionsFingerprint))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(comissoes.setSettings(outro.dono, c.tenantId, c.ana, remover(atual.exceptionsFingerprint))).rejects.toThrow(
      NotFoundException,
    );
    await expect(comissoes.setSettings(c.dono, c.tenantId, outro.ana, remover(atual.exceptionsFingerprint))).rejects.toThrow(
      NotFoundException,
    );
    expect(await regrasDe(c.tenantId, c.ana)).toEqual(antes);

    // Remover com a lista revisada: a regra geral vale em todos os serviços.
    const depois = await comissoes.setSettings(c.dono, c.tenantId, c.ana, remover(atual.exceptionsFingerprint));
    expect(depois.services.every((s) => s.rule === null && s.effective.source === 'DEFAULT')).toBe(true);
    expect(await regrasDe(c.tenantId, c.ana)).toEqual([]);
    expect(await efetivas(c, c.ana)).toMatchObject({ Barba: { source: 'DEFAULT', rule: pct(2000) } });
    // Só as da Ana: as da Bia e as de outro estabelecimento ficam.
    expect(await regrasDe(c.tenantId, c.bia)).toEqual(daBia);
    expect(await regrasDe(outro.tenantId, outro.ana)).toEqual(doOutro);
    // O já apurado guarda a fotografia; a conclusão seguinte usa 20% na barba.
    expect((await linhas(mantida.id)).map(resumo)).toEqual(fotografia);
    const removida = await reservar(c, [c.corte, c.barba], as(OUTRO_DIA, 9));
    await concluir(c, removida.id, as(OUTRO_DIA, 9));
    expect((await linhas(removida.id)).map(resumo)).toEqual([
      [c.corte, 'DEFAULT', 'PERCENTAGE', 2000, 850],
      [c.barba, 'DEFAULT', 'PERCENTAGE', 2000, 500],
    ]);
    // Auditoria: a remoção, com o que valia em cada serviço.
    const ultima = (await auditoriasDe(c.tenantId, c.ana)).at(-1);
    expect(ultima?.summary).toBe(
      `Comissão de Ana excecoes-individual: recebe, regra geral 20.00% (sem mudança); 2 exceções por serviço removidas: Barba 15.00%, Corte R$ 5.00 fixo.`,
    );
    expect(ultima?.new_data).toEqual({
      professionalId: c.ana,
      settings: { receivesCommission: true, defaultRule: pct(2000) },
      removedExceptions: [
        { serviceId: c.barba, serviceName: 'Barba', rule: pct(1500) },
        { serviceId: c.corte, serviceName: 'Corte', rule: fixo(500) },
      ],
    });
    // Repetir o pedido (rede caiu): a impressão antiga já não vale.
    await expect(comissoes.setSettings(c.dono, c.tenantId, c.ana, remover(atual.exceptionsFingerprint))).rejects.toMatchObject(
      excecoesDesatualizadas,
    );
  });

  it('individuais: Ana Luiza 20%, Lucas 10% e Marcos R$ 15 por serviço; Marcos sem exceções gera R$ 15 em cada serviço', async () => {
    const c = await cenario('excecoes-individuais');
    const criar = async (n: string, serviceIds: string[]) => {
      const p = await profissionais.create(c.dono, c.tenantId, { name: `${n} excecoes-individuais`, serviceIds });
      await horarios.replace(c.dono, c.tenantId, p.id, { days: [{ weekday: WEEKDAY, intervals: [{ start: '08:00', end: '20:00' }] }] });
      return p.id;
    };
    const lucas = await criar('Lucas', [c.corte]);
    const marcos = await criar('Marcos', [c.corte, c.barba, c.avaliacao]);
    // Marcos tinha uma exceção de 50% na barba.
    await comissoes.setRule(c.dono, c.tenantId, marcos, c.barba, pct(5000));
    const so = async (professionalId: string, defaultRule: { kind: 'PERCENTAGE' | 'FIXED'; value: number }, exceptions: 'KEEP' | 'REMOVE') => {
      const pedido = { target: 'SELECTED' as const, professionalIds: [professionalId], defaultRule, mode: 'REPLACE' as const, exceptions };
      const previa = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
      return comissoes.applyBulkSettings(c.dono, c.tenantId, {
        ...pedido,
        fingerprint: previa.fingerprint,
        confirmReplace: true,
        ...(exceptions === 'REMOVE' ? { confirmRemoveExceptions: true as const } : {}),
      });
    };
    await so(c.ana, pct(2000), 'KEEP');
    await so(lucas, pct(1000), 'KEEP');
    const doMarcos = await so(marcos, fixo(1500), 'REMOVE');
    expect(doMarcos.summary).toEqual({ change: 1, preserve: 0, unchanged: 0, total: 1, exceptionsRemoved: 1 });
    // Cada um com a própria regra; só os escolhidos de cada vez mudaram.
    expect((await comissoes.rules(c.dono, c.tenantId, c.ana)).settings).toEqual({ receivesCommission: true, defaultRule: pct(2000) });
    expect((await comissoes.rules(c.dono, c.tenantId, lucas)).settings).toEqual({ receivesCommission: true, defaultRule: pct(1000) });
    expect((await comissoes.rules(c.dono, c.tenantId, marcos)).settings).toEqual({ receivesCommission: true, defaultRule: fixo(1500) });
    expect((await comissoes.rules(c.dono, c.tenantId, c.bia)).settings).toEqual({ receivesCommission: true, defaultRule: null });
    // Marcos: R$ 15 em cada serviço concluído, qualquer que seja o preço
    // (42,50, 25,00 e sob consulta).
    const feita = await reservar(c, [c.corte, c.barba, c.avaliacao], as(DIA, 10), marcos);
    await concluir(c, feita.id, as(DIA, 10));
    expect((await linhas(feita.id)).map(resumo)).toEqual([
      [c.corte, 'DEFAULT', 'FIXED', 1500, 1500],
      [c.barba, 'DEFAULT', 'FIXED', 1500, 1500],
      [c.avaliacao, 'DEFAULT', 'FIXED', 1500, 1500],
    ]);
    // Lucas: 10% do corte.
    const doLucas = await reservar(c, [c.corte], as(DIA, 14), lucas);
    await concluir(c, doLucas.id, as(DIA, 14));
    expect((await linhas(doLucas.id)).map(resumo)).toEqual([[c.corte, 'DEFAULT', 'PERCENTAGE', 1000, 425]]);
  });

  it('em massa, SUBSTITUIR removendo exceções: só dos escolhidos, prévia mostra quais e quantas, atômico e auditado', async () => {
    const c = await cenarioEmMassa('massa-excecoes');
    const outro = await cenario('massa-excecoes-outro');
    await comissoes.setRule(c.dono, c.tenantId, c.edu, c.corte, fixo(700));
    await comissoes.setRule(outro.dono, outro.tenantId, outro.ana, outro.corte, pct(4000));
    const doEdu = await regrasDe(c.tenantId, c.edu);
    const doOutro = await regrasDe(outro.tenantId, outro.ana);
    const feita = await reservar(c, [c.corte, c.barba], as(DIA, 9));
    await concluir(c, feita.id, as(DIA, 9));
    const apuradas = (await excecoesEApuracoes(c.tenantId)).apuradas;

    const pedido = { target: 'SELECTED' as const, professionalIds: [c.ana, c.bia], defaultRule: pct(2000), mode: 'REPLACE' as const };
    // Manter (padrão): as exceções aparecem, mas não serão removidas.
    const mantendo = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
    expect(mantendo.exceptions).toBe('KEEP');
    expect(mantendo.summary.exceptionsRemoved).toBe(0);
    const anaMantendo = mantendo.professionals.find((p) => p.professional.id === c.ana);
    expect(anaMantendo?.exceptions).toEqual({ services: [{ service: { id: c.corte, name: 'Corte' }, rule: { kind: 'NONE', value: null } }], removed: false });
    // Remover: a prévia diz quem perde quais exceções.
    const removendo = { ...pedido, exceptions: 'REMOVE' as const };
    const previa = await comissoes.previewBulkSettings(c.dono, c.tenantId, removendo);
    expect(previa.fingerprint).not.toBe(mantendo.fingerprint);
    expect(previa.summary).toEqual({ change: 2, preserve: 0, unchanged: 0, total: 2, exceptionsRemoved: 1 });
    expect(Object.fromEntries(previa.professionals.map((p) => [p.professional.name.split(' ')[0], p.exceptions.removed]))).toEqual({
      Ana: true,
      Bia: false,
    });
    const confirmado = { ...removendo, confirmReplace: true as const, confirmRemoveExceptions: true as const };
    // A impressão de "manter" não serve para remover.
    await expect(comissoes.applyBulkSettings(c.dono, c.tenantId, { ...confirmado, fingerprint: mantendo.fingerprint })).rejects.toMatchObject(
      desatualizada,
    );

    // Atomicidade: se a remoção falhar, a regra geral também não muda.
    const gatilho = `falha_excecoes_${sufixo}`;
    await db.query(
      `CREATE FUNCTION ${gatilho}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'falha simulada'; END $f$`,
    );
    await db.query(
      `CREATE TRIGGER ${gatilho} BEFORE DELETE ON commission_rules FOR EACH ROW WHEN (OLD.tenant_id = '${c.tenantId}') EXECUTE FUNCTION ${gatilho}()`,
    );
    const configuradas = await configuracoes(c.tenantId);
    try {
      await expect(comissoes.applyBulkSettings(c.dono, c.tenantId, { ...confirmado, fingerprint: previa.fingerprint })).rejects.toThrow(
        'falha simulada',
      );
    } finally {
      await db.query(`DROP TRIGGER ${gatilho} ON commission_rules`);
      await db.query(`DROP FUNCTION ${gatilho}()`);
    }
    expect(await configuracoes(c.tenantId)).toEqual(configuradas);
    expect((await regrasDe(c.tenantId, c.ana)).length).toBe(1);

    const aplicada = await comissoes.applyBulkSettings(c.dono, c.tenantId, { ...confirmado, fingerprint: previa.fingerprint });
    expect(aplicada).toMatchObject({ applied: true, exceptions: 'REMOVE', summary: previa.summary });
    expect(await regrasDe(c.tenantId, c.ana)).toEqual([]);
    expect(await efetivas(c, c.ana)).toMatchObject({ Corte: { source: 'DEFAULT', rule: pct(2000) } });
    // Fora da escolha e de outro estabelecimento: intactas; apurações também.
    expect(await regrasDe(c.tenantId, c.edu)).toEqual(doEdu);
    expect(await regrasDe(outro.tenantId, outro.ana)).toEqual(doOutro);
    expect((await excecoesEApuracoes(c.tenantId)).apuradas).toEqual(apuradas);
    const auditoria = await auditoriaDaOperacao(c.tenantId, aplicada.operationId);
    expect(auditoria.map((a) => a.summary)).toEqual([
      'Comissão de Ana massa-excecoes (aplicação em massa, substituir): recebe, regra geral não definida → recebe, regra geral 20.00%; exceção por serviço removida: Corte sem comissão.',
      'Comissão de Bia massa-excecoes (aplicação em massa, substituir): recebe, regra geral R$ 15.00 fixo → recebe, regra geral 20.00%.',
    ]);
    expect(auditoria[0].previous_data.exceptions).toEqual([{ serviceId: c.corte, serviceName: 'Corte', rule: { kind: 'NONE', value: null } }]);
    expect(auditoria[0].new_data).toMatchObject({
      removedExceptions: [{ serviceId: c.corte, serviceName: 'Corte', rule: { kind: 'NONE', value: null } }],
      bulk: { operationId: aplicada.operationId, mode: 'REPLACE', exceptions: 'REMOVE' },
    });
    expect(auditoria[1].new_data).not.toHaveProperty('removedExceptions');

    // Regra geral já igual: só a remoção da exceção altera o Edu.
    const soEdu = { target: 'SELECTED' as const, professionalIds: [c.edu], defaultRule: pct(1000), mode: 'REPLACE' as const, exceptions: 'REMOVE' as const };
    const doEduPrevia = await comissoes.previewBulkSettings(c.dono, c.tenantId, soEdu);
    expect(doEduPrevia.professionals[0]).toMatchObject({ outcome: 'CHANGE', exceptions: { removed: true } });
    // Uma exceção muda antes da aplicação: 409, nada gravado.
    await comissoes.setRule(c.dono, c.tenantId, c.edu, c.corte, fixo(800));
    const doEduAntes = await regrasDe(c.tenantId, c.edu);
    await expect(
      comissoes.applyBulkSettings(c.dono, c.tenantId, {
        ...soEdu,
        fingerprint: doEduPrevia.fingerprint,
        confirmReplace: true,
        confirmRemoveExceptions: true,
      }),
    ).rejects.toMatchObject(desatualizada);
    expect(await regrasDe(c.tenantId, c.edu)).toEqual(doEduAntes);
    // Mesmo mantendo exceções, uma exceção nova desatualiza a prévia.
    const mantendoEdu = await comissoes.previewBulkSettings(c.dono, c.tenantId, { ...soEdu, exceptions: 'KEEP' });
    await comissoes.clearRule(c.dono, c.tenantId, c.edu, c.corte);
    await expect(
      comissoes.applyBulkSettings(c.dono, c.tenantId, { ...soEdu, exceptions: 'KEEP', fingerprint: mantendoEdu.fingerprint, confirmReplace: true }),
    ).rejects.toMatchObject(desatualizada);
  });

  it('em massa removendo exceções: espera uma mudança de exceção em curso e a recusa como prévia desatualizada', async () => {
    const c = await cenarioEmMassa('massa-excecoes-trava');
    const pedido = {
      target: 'SELECTED' as const,
      professionalIds: [c.ana],
      defaultRule: pct(2000),
      mode: 'REPLACE' as const,
      exceptions: 'REMOVE' as const,
      confirmReplace: true as const,
      confirmRemoveExceptions: true as const,
    };
    const { fingerprint } = await comissoes.previewBulkSettings(c.dono, c.tenantId, pedido);
    // `setRule` em curso: travou a Ana e mudou a exceção do corte.
    const mudanca = db.createQueryRunner();
    await mudanca.connect();
    await mudanca.startTransaction();
    let recusa: Promise<unknown> | undefined;
    try {
      const [{ pid }] = (await mudanca.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[];
      await mudanca.query('SELECT 1 FROM professionals WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [c.tenantId, c.ana]);
      await mudanca.query(
        `UPDATE commission_rules SET type = 'FIXED', value = 900 WHERE tenant_id = $1 AND professional_id = $2 AND service_id = $3`,
        [c.tenantId, c.ana, c.corte],
      );
      recusa = comissoes.applyBulkSettings(c.dono, c.tenantId, { ...pedido, fingerprint });
      recusa.catch(() => undefined);
      await esperarBloqueadas(pid, 'FOR UPDATE');
      await mudanca.commitTransaction();
      await expect(recusa).rejects.toMatchObject(desatualizada);
    } finally {
      if (mudanca.isTransactionActive) await mudanca.rollbackTransaction();
      await mudanca.release();
    }
    // A exceção nova ficou; a regra geral não mudou.
    expect(await regrasDe(c.tenantId, c.ana)).toEqual([{ service_id: c.corte, type: 'FIXED', value: 900 }]);
    expect((await comissoes.rules(c.dono, c.tenantId, c.ana)).settings.defaultRule).toBeNull();
  });

});
