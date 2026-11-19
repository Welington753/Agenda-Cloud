// Regras compartilhadas do cadastro de clientes (ver
// docs/plans/clientes-ficha-e-duplicados.md): trava por telefone, impressão
// do pedido de cadastro e as recusas que a tela distingue pelo `code`.
//
// Identidade: `consumers.id`. Telefone e nome são critérios de
// correspondência, nunca identidade. As chaves de comparação
// (`name_key`, `phone_match_key`) vêm das funções do banco
// (migration ConsumerIdentity), nunca de uma cópia aqui.
import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { CONSUMER_MERGED_SQLSTATE } from '../migrations/1794268800000-ConsumerIdentity.js';

/**
 * Serializa, até o fim da transação, quem cria ou troca um cadastro para o
 * MESMO telefone no mesmo estabelecimento: o cadastro pela tela, o cliente
 * novo da agenda, a edição e o agendamento público (mesma chave de
 * `travarTelefone` em public-booking.repository.ts). Telefones diferentes
 * não se esperam.
 */
export async function travarTelefoneDoCliente(
  manager: EntityManager,
  tenantId: string,
  telefoneNormalizado: string,
): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `public-booking:${tenantId}:${telefoneNormalizado}`,
  ]);
}

export const TELEFONE_EM_USO_MESSAGE =
  'Já existe um cliente com este WhatsApp neste estabelecimento. Busque por ele em vez de cadastrar de novo.';
export const CHAVE_REUTILIZADA_MESSAGE =
  'Este envio já foi usado com outros dados. Recarregue a página e tente de novo.';
export const CLIENTE_UNIFICADO_MESSAGE =
  'Este cliente foi unificado com outro cadastro; escolha o cadastro principal.';
export const CLIENTE_ALTERADO_MESSAGE =
  'Este cadastro foi alterado por outra pessoa. Recarregue para ver a versão atual.';

export function telefoneEmUso(): ConflictException {
  return new ConflictException({ statusCode: 409, code: 'TELEFONE_EM_USO', message: TELEFONE_EM_USO_MESSAGE });
}

export function chaveReutilizada(): ConflictException {
  return new ConflictException({ statusCode: 409, code: 'CHAVE_REUTILIZADA', message: CHAVE_REUTILIZADA_MESSAGE });
}

/** `principalId`: o cadastro ativo que ficou com o histórico. */
export function clienteUnificado(principalId: string | null): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'CLIENTE_UNIFICADO',
    message: CLIENTE_UNIFICADO_MESSAGE,
    principalId,
  });
}

export function clienteAlterado(): ConflictException {
  return new ConflictException({ statusCode: 409, code: 'CLIENTE_ALTERADO', message: CLIENTE_ALTERADO_MESSAGE });
}

/** O erro do gatilho `trg_appointments_consumer_active` (cadastro unificado);
 * devolve o principal gravado no DETAIL, ou `undefined` se for outro erro. */
export function principalDoErroDeUnificado(error: unknown): string | null | undefined {
  const candidato = error as { code?: unknown; detail?: unknown; driverError?: { code?: unknown; detail?: unknown } };
  const fonte = candidato?.driverError ?? candidato;
  if (fonte?.code !== CONSUMER_MERGED_SQLSTATE) return undefined;
  return typeof fonte.detail === 'string' && fonte.detail.length > 0 ? fonte.detail : null;
}

/** Nome como a pessoa quis gravar: aparado e com espaços colapsados. */
export function nomeAparado(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ');
}

export interface PedidoDeCadastro {
  name: string;
  whatsappNormalized: string;
  email: string | null | undefined;
  outraPessoa: boolean;
}

/**
 * Impressão (SHA-256, hex) dos dados NORMALIZADOS do pedido original de
 * cadastro. É gravada uma vez em `consumer_create_requests` e o reenvio com
 * a mesma chave é comparado SEMPRE com ela, nunca com o cadastro atual: uma
 * edição posterior do cliente não transforma o reenvio em reuso indevido.
 */
export function impressaoDoPedido(pedido: PedidoDeCadastro): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        nomeAparado(pedido.name),
        pedido.whatsappNormalized,
        pedido.email ? pedido.email.trim().toLowerCase() : null,
        pedido.outraPessoa,
      ]),
    )
    .digest('hex');
}
