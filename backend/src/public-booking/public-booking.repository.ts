// SQL explícito das duas tabelas do agendamento público (ver
// 1792627200000-PublicBooking.ts). Toda função recebe o `EntityManager` de
// quem chama: dentro de uma transação, a leitura e a gravação valem para ela.
//
// Toda consulta leva `tenant_id` no `where`. Nenhuma função daqui devolve
// dado de cliente: só ids, contagens e o necessário para o recibo.
import type { EntityManager } from 'typeorm';
import { generateId } from '../entities/common/generate-id.js';

export interface ConfiguracaoPublica {
  enabled: boolean;
  updatedAt: Date | null;
}

export interface PedidoRegistrado {
  appointmentId: string;
  payloadHash: string;
}

/** Linha ausente = desligado. `FOR SHARE` (com `travar`) faz o pedido
 * público serializar com quem desliga a página no mesmo instante. */
export async function configuracaoDo(
  manager: EntityManager,
  tenantId: string,
  travar = false,
): Promise<ConfiguracaoPublica> {
  const linhas = (await manager.query(
    `SELECT enabled, updated_at FROM public_booking_settings WHERE tenant_id = $1${travar ? ' FOR SHARE' : ''}`,
    [tenantId],
  )) as { enabled: boolean; updated_at: Date }[];
  if (linhas.length === 0) return { enabled: false, updatedAt: null };
  return { enabled: linhas[0].enabled, updatedAt: linhas[0].updated_at };
}

export async function gravarConfiguracao(
  manager: EntityManager,
  tenantId: string,
  enabled: boolean,
  userId: string,
): Promise<ConfiguracaoPublica> {
  const linhas = (await manager.query(
    `INSERT INTO public_booking_settings (tenant_id, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (tenant_id) DO UPDATE
       SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING enabled, updated_at`,
    [tenantId, enabled, userId],
  )) as { enabled: boolean; updated_at: Date }[];
  return { enabled: linhas[0].enabled, updatedAt: linhas[0].updated_at };
}

/**
 * Serializa, até o fim da transação, os pedidos do MESMO telefone no mesmo
 * estabelecimento. Sem isto, dois envios simultâneos leriam a mesma contagem
 * e passariam os dois pelo limite. Pedidos de telefones diferentes não se
 * esperam (chave diferente).
 */
export async function travarTelefone(
  manager: EntityManager,
  tenantId: string,
  telefone: string,
): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `public-booking:${tenantId}:${telefone}`,
  ]);
}

/**
 * Serializa os pedidos públicos para o MESMO profissional. Dois pedidos
 * simultâneos para o mesmo horário chegavam juntos ao INSERT e, no CI, o
 * PostgreSQL resolvia a espera mútua (constraint de exclusão + locks de
 * linha) com `deadlock detected` em vez do 23P01. Com este lock, o segundo
 * espera o primeiro commitar e então vê o horário ocupado (409 limpo).
 * Tomado DEPOIS do lock de telefone, sempre nesta ordem.
 */
export async function travarProfissional(
  manager: EntityManager,
  tenantId: string,
  professionalId: string,
): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `public-booking-professional:${tenantId}:${professionalId}`,
  ]);
}

export async function pedidoPelaChave(
  manager: EntityManager,
  tenantId: string,
  chave: string,
): Promise<PedidoRegistrado | null> {
  const linhas = (await manager.query(
    `SELECT appointment_id, payload_hash FROM public_booking_requests
      WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, chave],
  )) as { appointment_id: string; payload_hash: string }[];
  if (linhas.length === 0) return null;
  return { appointmentId: linhas[0].appointment_id, payloadHash: linhas[0].payload_hash };
}

/** Pedidos deste telefone neste tenant desde `desde` (qualquer estado). */
export async function pedidosRecentes(
  manager: EntityManager,
  tenantId: string,
  telefone: string,
  desde: Date,
): Promise<number> {
  const [linha] = (await manager.query(
    `SELECT count(*)::int AS total FROM public_booking_requests
      WHERE tenant_id = $1 AND phone_normalized = $2 AND created_at >= $3`,
    [tenantId, telefone, desde],
  )) as { total: number }[];
  return linha.total;
}

/** Pedidos deste telefone ainda `PENDING` e com início no futuro. */
export async function pendentesFuturos(
  manager: EntityManager,
  tenantId: string,
  telefone: string,
  agora: Date,
): Promise<number> {
  const [linha] = (await manager.query(
    `SELECT count(*)::int AS total
       FROM public_booking_requests r
       JOIN appointments a ON a.tenant_id = r.tenant_id AND a.id = r.appointment_id
      WHERE r.tenant_id = $1 AND r.phone_normalized = $2
        AND a.status = 'PENDING' AND a.start_at > $3`,
    [tenantId, telefone, agora],
  )) as { total: number }[];
  return linha.total;
}

export async function registrarPedido(
  manager: EntityManager,
  dados: {
    tenantId: string;
    appointmentId: string;
    telefone: string;
    chave: string;
    payloadHash: string;
    agora: Date;
  },
): Promise<void> {
  await manager.query(
    `INSERT INTO public_booking_requests
       (id, tenant_id, appointment_id, phone_normalized, idempotency_key, payload_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      generateId(),
      dados.tenantId,
      dados.appointmentId,
      dados.telefone,
      dados.chave,
      dados.payloadHash,
      dados.agora,
    ],
  );
}

/**
 * Cliente deste tenant com este telefone, criado se ainda não existe.
 *
 * Cliente EXISTENTE: nada nele é alterado — nem nome, nem e-mail, nem
 * autorização de contato. Quem preenche o formulário público não prova que
 * é o dono do cadastro, então não pode reescrevê-lo.
 *
 * Cliente NOVO: nasce só com nome e telefone; as colunas de autorização de
 * contato ficam NULAS (ninguém é dado como autorizado por ter pedido).
 *
 * `ON CONFLICT DO NOTHING` em vez de capturar o erro de UNIQUE: um erro
 * dentro da transação a deixaria abortada, e dois pedidos simultâneos do
 * mesmo telefone novo são possíveis (de tenants diferentes não se cruzam;
 * do mesmo tenant, `travarTelefone` já os serializa — isto é a segunda
 * barreira).
 */
export async function clienteDoTelefone(
  manager: EntityManager,
  tenantId: string,
  dados: { nome: string; whatsapp: string; telefone: string },
): Promise<string> {
  await manager.query(
    `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ON CONSTRAINT uq_consumers_tenant_whatsapp DO NOTHING`,
    [generateId(), tenantId, dados.nome, dados.whatsapp, dados.telefone],
  );
  const [linha] = (await manager.query(
    `SELECT id FROM consumers WHERE tenant_id = $1 AND whatsapp_normalized = $2`,
    [tenantId, dados.telefone],
  )) as { id: string }[];
  return linha.id;
}

/** Quais destas reservas vieram do agendamento público. */
export async function origemPublica(
  manager: EntityManager,
  tenantId: string,
  appointmentIds: readonly string[],
): Promise<Map<string, Date>> {
  if (appointmentIds.length === 0) return new Map();
  const linhas = (await manager.query(
    `SELECT appointment_id, created_at FROM public_booking_requests
      WHERE tenant_id = $1 AND appointment_id = ANY($2::varchar[])`,
    [tenantId, appointmentIds],
  )) as { appointment_id: string; created_at: Date }[];
  return new Map(linhas.map((l) => [l.appointment_id, l.created_at]));
}
