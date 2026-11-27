// Alcance real com dados fictícios, contra PostgreSQL DESCARTÁVEL
// (docs/plans/permissoes-individuais.md, seção 5.4, etapa 1). Os serviços de
// verdade respondem para cada vínculo semeado, e a resposta é conferida com a
// impressão da REFERÊNCIA CONGELADA do piloto (test/access-fingerprint,
// cópia de 8f71335):
//
// - recusa ou resposta em cada rota de consulta, pela ação correspondente
//   da impressão (com a entrada de ajustes que a rota usa);
// - as áreas da sessão, com os recursos e as vendas do estabelecimento;
// - os campos escondidos (preço, contato, recebimento) de cada item devolvido.
//
// A coleta roda duas vezes sobre o mesmo banco e precisa sair idêntica:
// nenhum campo técnico varia entre execuções, então nada é normalizado.
// O mesmo coletor roda na cópia restaurada (antes e depois) pelo roteiro
// docs/runbooks/ensaio-alcance-real-permissoes.md.
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { EstablishmentRole } from '../src/entities/enums/establishment-role.enum.js';
import { ENABLED_FEATURES_SQL } from '../src/commercial/feature-areas.js';
import { comTodosOsRecursos } from './support/plano-de-teste.js';
import { coletarAlcance, type Coleta, type Resposta, type VinculoColetado } from './alcance-real/coletar-alcance.js';
import {
  accessFingerprint,
  implementacaoAntes,
  type Ajuste,
  type Cenario,
  type SituacaoDoProfissional,
} from './access-fingerprint/access-fingerprint.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const OPCOES = { agora: new Date('2026-11-27T15:00:00.000Z'), de: '2026-11-01', ate: '2026-11-30', dia: '2026-11-28' };

/** Rota de consulta e a ação da impressão que a decide (recursos todos ligados). */
const ROTA_PARA_ACAO: Readonly<Record<string, string>> = {
  'agenda.periodo': 'agenda.ver:todos',
  'comissoes.relatorio': 'comissoes.ver:todos',
  'recebimentos.lista': 'recebimentos.ver:todos',
  'clientes.pagina': 'clientes.ver:todos',
  'disponibilidade.consulta': 'disponibilidade.ver:todos',
  'servicos.lista': 'servicos.ver:todos',
  'profissionais.lista': 'profissionais.ver:todos',
  'estoque.produtos': 'estoque.ver:todos',
  'vendas.lista.mine': 'vendas.consultar:proprias',
  'vendas.lista.all': 'vendas.consultar:todas',
  'equipe.visao': 'equipe.gerenciar:estabelecimento',
};

describe.skipIf(!url)('alcance real por vínculo contra PostgreSQL descartável (dados fictícios)', () => {
  let db: DataSource;
  const marca = `alc${id().slice(0, 8)}`;
  const cenarios = new Map<string, Omit<Cenario, 'recursos' | 'haVendas' | 'rotulo'> & { status: string; nome: string }>();
  let tenantId = '';
  let parcial = '';
  let coleta: Coleta;

  async function conta(nome: string) {
    const userId = id();
    await db.query(`INSERT INTO users (id, name, email, status, email_verified) VALUES ($1, $2, $3, 'ACTIVE', true)`, [
      userId,
      `Pessoa ${nome}`,
      `${marca}-${nome}@example.test`,
    ]);
    return userId;
  }

  async function estabelecimento(nome: string, fora: readonly string[], comVendas: boolean) {
    const planId = id();
    await db.query(
      comTodosOsRecursos(`INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $2, $3, '', 20, 1)`, fora),
      [planId, `${marca}-${nome}`, `Plano ${nome}`],
    );
    const t = id();
    const unitId = id();
    await db.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now())`,
      [t, `${marca}-${nome}`, planId],
    );
    await db.query(
      `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', 'America/Sao_Paulo', true)`,
      [unitId, t, `${marca} ${nome}`],
    );
    if (comVendas) {
      await db.query(
        `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) SELECT $1, $2, id, true FROM features WHERE key = 'VENDAS'`,
        [id(), t],
      );
    }
    return { t, unitId };
  }

  async function profissional(t: string, nome: string, ativo: boolean, serviceId: string) {
    const professionalId = id();
    await db.query(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color, active) VALUES ($1, $2, $3, 'PX', '#000000', $4)`,
      [professionalId, t, `Profissional ${nome}`, ativo],
    );
    await db.query(`INSERT INTO professional_services (id, tenant_id, professional_id, service_id) VALUES ($1, $2, $3, $4)`, [
      id(),
      t,
      professionalId,
      serviceId,
    ]);
    return professionalId;
  }

  async function vinculo(
    t: string,
    nome: string,
    dados: { role: EstablishmentRole; confirmado?: boolean; professionalId?: string | null; situacao?: SituacaoDoProfissional; gravados?: Ajuste[]; status?: string },
  ) {
    const userId = await conta(nome);
    const membershipId = id();
    await db.query(
      `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, status, permissions_confirmed_at)
       VALUES ($1, $2, $3, $4::establishment_role, $5, $6, CASE WHEN $7 THEN now() END)`,
      [membershipId, userId, t, dados.role, dados.professionalId ?? null, dados.status ?? 'ACTIVE', dados.confirmado ?? false],
    );
    for (const o of dados.gravados ?? []) {
      await db.query(
        `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
         VALUES ($1, $2, $3, $4::permission, $5::permission_mode)`,
        [id(), t, membershipId, o.permission, o.mode],
      );
    }
    cenarios.set(membershipId, {
      nome,
      role: dados.role,
      confirmado: dados.confirmado ?? false,
      profissional: dados.situacao ?? 'sem',
      gravados: dados.gravados ?? [],
      status: dados.status ?? 'ACTIVE',
    });
    return membershipId;
  }

  const G = (...ps: string[]): Ajuste[] => ps.map((permission) => ({ permission, mode: 'GRANTED' }));
  const D = (...ps: string[]): Ajuste[] => ps.map((permission) => ({ permission, mode: 'DENIED' }));

  beforeAll(async () => {
    const directoryPath = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(directoryPath, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();

    // Estabelecimento com todos os recursos (VENDAS pelo adicional) e um sem
    // estoque, vendas, comissões e pagamentos, com os mesmos papéis.
    const completo = await estabelecimento('completo', [], true);
    const semAdicionais = await estabelecimento('parcial', ['feat_estoque', 'feat_comissoes', 'feat_pagamentos'], false);
    tenantId = completo.t;
    parcial = semAdicionais.t;
    for (const { t, unitId } of [completo, semAdicionais]) {
      const serviceId = id();
      await db.query(
        `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte', '', 60, 5000)`,
        [serviceId, t],
      );
      const consumerId = id();
      await db.query(
        `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Fictício', '11999990000', $3)`,
        [consumerId, t, `5511${Math.floor(Math.random() * 1e9)}`],
      );
      const ativo = await profissional(t, 'ativo', true, serviceId);
      const ativoGerente = await profissional(t, 'gerente', true, serviceId);
      const inativo = await profissional(t, 'inativo', false, serviceId);
      for (const [professionalId, dia] of [
        [ativo, '2026-11-10T13:00:00.000Z'],
        [ativoGerente, '2026-11-11T13:00:00.000Z'],
        [inativo, '2026-11-12T13:00:00.000Z'],
      ] as const) {
        const appointmentId = id();
        const inicio = new Date(dia);
        await db.query(
          `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
              professional_id, start_at, end_at, status, notes)
           VALUES ($1, $2, $3, $4, 'Cliente Fictício', '11999990000', $5, $6, $7, 'COMPLETED'::appointment_status, 'observação interna')`,
          [appointmentId, t, unitId, consumerId, professionalId, inicio, new Date(inicio.getTime() + 3_600_000)],
        );
        await db.query(
          `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
           VALUES ($1, $2, $3, $4, 60, 5000)`,
          [id(), t, appointmentId, serviceId],
        );
      }
      const tudo = [
        'AGENDA_VISUALIZAR', 'AGENDA_GERENCIAR', 'AGENDAMENTO_CRIAR', 'AGENDAMENTO_EDITAR', 'AGENDAMENTO_CANCELAR',
        'SOLICITACOES_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR', 'PROFISSIONAIS_GERENCIAR', 'SERVICOS_VISUALIZAR',
        'SERVICOS_GERENCIAR', 'CONSUMIDORES_VISUALIZAR', 'CONSUMIDORES_GERENCIAR', 'RECEBIMENTOS_VISUALIZAR',
        'RECEBIMENTOS_REGISTRAR', 'COMISSOES_VISUALIZAR', 'ESTOQUE_VISUALIZAR', 'VENDAS_VISUALIZAR', 'VENDAS_REGISTRAR',
      ];
      const proprias = ['ATENDIMENTO_PROPRIO_INICIAR', 'ATENDIMENTO_PROPRIO_CONCLUIR', 'COMISSOES_PROPRIAS_VISUALIZAR'];
      const DONO = EstablishmentRole.DONO;
      const GERENTE = EstablishmentRole.GERENTE;
      const RECEPCIONISTA = EstablishmentRole.RECEPCIONISTA;
      const PROFISSIONAL = EstablishmentRole.PROFISSIONAL;
      await vinculo(t, `${t}-dono`, { role: DONO });
      await vinculo(t, `${t}-dono-restrito`, { role: DONO, gravados: D('AGENDA_VISUALIZAR', 'RECEBIMENTOS_VISUALIZAR', 'SERVICOS_GERENCIAR') });
      await vinculo(t, `${t}-gerente-agenda`, { role: GERENTE, confirmado: true, gravados: G('AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR') });
      await vinculo(t, `${t}-gerente-recebimentos`, {
        role: GERENTE,
        confirmado: true,
        gravados: G('AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR', 'RECEBIMENTOS_VISUALIZAR'),
      });
      await vinculo(t, `${t}-gerente-tudo`, { role: GERENTE, confirmado: true, gravados: G(...tudo) });
      await vinculo(t, `${t}-gerente-negado`, { role: GERENTE, confirmado: true, gravados: [...G(...tudo.filter((p) => p !== 'PROFISSIONAIS_VISUALIZAR')), ...D('PROFISSIONAIS_VISUALIZAR')] });
      await vinculo(t, `${t}-gerente-nao-confirmado`, { role: GERENTE, confirmado: false, gravados: G(...tudo, ...proprias) });
      await vinculo(t, `${t}-gerente-profissional`, {
        role: GERENTE,
        confirmado: true,
        professionalId: ativoGerente,
        situacao: 'ativo',
        gravados: G('AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR', ...proprias),
      });
      await vinculo(t, `${t}-profissional`, { role: PROFISSIONAL, professionalId: ativo, situacao: 'ativo', gravados: G(...proprias, 'VENDAS_REGISTRAR') });
      await vinculo(t, `${t}-profissional-inativo`, { role: PROFISSIONAL, professionalId: inativo, situacao: 'inativo', gravados: G(...proprias) });
      await vinculo(t, `${t}-profissional-sem`, { role: PROFISSIONAL, gravados: G(...proprias) });
      await vinculo(t, `${t}-recepcionista`, { role: RECEPCIONISTA, gravados: G('VENDAS_REGISTRAR', 'VENDAS_RECEBER') });
      await vinculo(t, `${t}-recepcionista-estoque`, { role: RECEPCIONISTA, gravados: G('ESTOQUE_VISUALIZAR', 'AGENDA_VISUALIZAR', ...proprias) });
      await vinculo(t, `${t}-suspenso`, { role: GERENTE, confirmado: true, gravados: G(...tudo), status: 'SUSPENDED' });
    }
    coleta = await coletarAlcance(db, { ...OPCOES, estabelecimentos: [tenantId, parcial] });
  }, 120_000);

  afterAll(async () => {
    // Nenhum GERENTE ativo fica para trás: os levantamentos do piloto
    // (pilot-team-manager-check) leem os gerentes do banco compartilhado.
    if (db?.isInitialized && tenantId) {
      await db.query(
        `UPDATE memberships SET status = 'SUSPENDED' WHERE tenant_id = ANY($1::text[]) AND role = 'GERENTE'`,
        [[tenantId, parcial].filter(Boolean)],
      );
    }
    if (db?.isInitialized) await db.destroy();
  });

  async function esperadoPelaReferencia(v: VinculoColetado) {
    const c = cenarios.get(v.membershipId)!;
    const ligados = ((await db.query(ENABLED_FEATURES_SQL, [v.tenantId])) as { key: string }[]).map((l) => l.key);
    const cenario: Cenario = { ...c, recursos: new Set(ligados), haVendas: false, rotulo: c.nome };
    const pares = await accessFingerprint(implementacaoAntes(), cenario);
    const valor = (chave: string) => pares.find((p) => p.startsWith(`${chave}=`))?.slice(chave.length + 1);
    return { c, pares, valor };
  }

  const ok = (r: Resposta | undefined) => r?.ok === true;

  it('cada vínculo do estabelecimento completo é recusado ou atendido como na referência do piloto', async () => {
    const divergencias: string[] = [];
    for (const v of coleta.vinculos.filter((x) => x.tenantId === tenantId)) {
      const { c, valor } = await esperadoPelaReferencia(v);
      if (c.status !== 'ACTIVE') {
        const atendidas = Object.entries(v.respostas).filter(([k, r]) => k !== 'sessao.areas' && r.ok).map(([k]) => k);
        if (atendidas.length) divergencias.push(`${c.nome}: suspenso atendido em ${atendidas.join(', ')}`);
        continue;
      }
      for (const [rota, acao] of Object.entries(ROTA_PARA_ACAO)) {
        const esperado = valor(acao) === 'sim';
        if (ok(v.respostas[rota]) !== esperado) {
          divergencias.push(`${c.nome}: ${rota} ${ok(v.respostas[rota]) ? 'atendida' : 'recusada'}, referência ${acao}=${valor(acao)}`);
        }
        const r = v.respostas[rota];
        if (r && !r.ok && r.status !== 403) divergencias.push(`${c.nome}: ${rota} recusada com ${r.status}`);
      }
      const propria = valor('agenda.ver:propria');
      if (ok(v.respostas['agenda.propria']) !== (propria === 'sim')) {
        divergencias.push(`${c.nome}: agenda própria ${ok(v.respostas['agenda.propria'])}, referência ${propria}`);
      }
      const comissoes = propria === 'sim' && valor('comissoes.ver:propria') === 'sim';
      if (ok(v.respostas['comissoes.proprias']) !== comissoes) {
        divergencias.push(`${c.nome}: próprias comissões ${ok(v.respostas['comissoes.proprias'])}, referência ${comissoes}`);
      }
    }
    expect(divergencias).toEqual([]);
    // Os casos semeados cobrem recusa e atendimento em cada rota.
    for (const rota of Object.keys(ROTA_PARA_ACAO)) {
      const valores = new Set(coleta.vinculos.filter((x) => x.tenantId === tenantId).map((x) => ok(x.respostas[rota])));
      expect([rota, valores.size]).toEqual([rota, 2]);
    }
  });

  it('as áreas da sessão (com recursos e vendas reais) são as da referência, nos dois estabelecimentos', async () => {
    const divergencias: string[] = [];
    for (const v of coleta.vinculos.filter((x) => cenarios.get(x.membershipId)!.status === 'ACTIVE')) {
      const { c, valor } = await esperadoPelaReferencia(v);
      const real = v.respostas['sessao.areas'];
      const esperado = (valor('sessao') ?? '').split(',').filter(Boolean).sort();
      if (!real.ok || JSON.stringify(real.resumo) !== JSON.stringify(esperado)) {
        divergencias.push(`${c.nome}: ${JSON.stringify(real.ok ? real.resumo : real)} esperado ${JSON.stringify(esperado)}`);
      }
    }
    expect(divergencias).toEqual([]);
  });

  it('campos escondidos na agenda, na própria agenda, na consulta de horários e no histórico são os da referência', async () => {
    const divergencias: string[] = [];
    for (const v of coleta.vinculos.filter((x) => x.tenantId === tenantId)) {
      const { c, valor } = await esperadoPelaReferencia(v);
      const recorte = JSON.parse(valor('campos.agenda[5000|2500]') ?? '{}') as { hidden?: string[] };
      const agenda = v.respostas['agenda.periodo'];
      if (agenda.ok) {
        for (const item of agenda.resumo as { id: string; hidden: string[]; priceCents: number | null; temContato: boolean; temObservacao: boolean }[]) {
          const escondidos = recorte.hidden ?? [];
          if (JSON.stringify(item.hidden) !== JSON.stringify(escondidos)) divergencias.push(`${c.nome}: agenda ${item.id} hidden ${item.hidden}`);
          if ((item.priceCents === null) !== escondidos.includes('price')) divergencias.push(`${c.nome}: preço da agenda`);
          if (item.temContato === escondidos.includes('contact')) divergencias.push(`${c.nome}: contato da agenda`);
        }
      }
      const consulta = v.respostas['disponibilidade.consulta'];
      if (consulta?.ok) {
        const ref = JSON.parse(valor('campos.disponibilidade[5000|2500]') ?? '{}') as { priceHidden: boolean };
        if ((consulta.resumo as { priceHidden: boolean }).priceHidden !== ref.priceHidden) divergencias.push(`${c.nome}: preço da consulta`);
      }
      const mostra = JSON.parse(valor('campos.historico.mostra') ?? '{}') as { veDinheiro: boolean; veRecebimentos: boolean };
      for (const [k, r] of Object.entries(v.respostas).filter(([k]) => k.startsWith('clientes.historico.'))) {
        if (!r.ok) continue;
        for (const item of r.resumo as { id: string; hidden: string[]; priceCents: number | null; payment: unknown }[]) {
          if ((item.priceCents === null) === mostra.veDinheiro) divergencias.push(`${c.nome}: ${k} preço`);
          if ((item.payment === 'ausente') === mostra.veRecebimentos) divergencias.push(`${c.nome}: ${k} recebimento`);
        }
      }
    }
    expect(divergencias).toEqual([]);
    // Houve gerente com preço e contato escondidos e alguém com tudo visível.
    const escondidos = coleta.vinculos.flatMap((v) => (v.respostas['agenda.periodo'].ok ? (v.respostas['agenda.periodo'].resumo as { hidden: string[] }[]) : []).map((i) => i.hidden.join('+')));
    expect(new Set(escondidos)).toEqual(new Set(['', 'price+contact', 'contact']));
  });

  it('a própria agenda devolve só os atendimentos do profissional ligado', async () => {
    for (const v of coleta.vinculos.filter((x) => x.tenantId === tenantId && x.respostas['agenda.propria'].ok)) {
      const propria = v.respostas['agenda.propria'] as Extract<Resposta, { ok: true }>;
      const resumo = propria.resumo as { professional: string; appointments: { id: string }[] };
      expect(resumo.professional).toBe(v.professionalId);
      const doProfissional = (
        (await db.query(`SELECT id FROM appointments WHERE tenant_id = $1 AND professional_id = $2 ORDER BY id`, [v.tenantId, v.professionalId])) as { id: string }[]
      ).map((a) => a.id);
      expect(resumo.appointments.map((a) => a.id)).toEqual(doProfissional);
    }
  });

  it('a coleta é determinística: a segunda execução sai idêntica, sem campo técnico variável', async () => {
    const segunda = await coletarAlcance(db, { ...OPCOES, estabelecimentos: [tenantId, parcial] });
    expect(segunda).toEqual(coleta);
  }, 120_000);
});
