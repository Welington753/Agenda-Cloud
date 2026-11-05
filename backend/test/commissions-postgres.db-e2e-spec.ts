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
//   individual vence o plano, e o plano não concede nada ao funcionário.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { apurarNaConclusao, reverterApuracao } from '../src/commissions/commission-accrual.js';
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
              ce.applied_value, ce.professional_cents, ce.establishment_cents, ce.status::text AS status, ce.calculated_at
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
});
