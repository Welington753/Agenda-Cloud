// Edição do catálogo modular em Planos e adicionais (ver
// docs/plans/edicao-catalogo-modular.md): nome, descrição e preço mensal
// padrão do Agendamento essencial e de cada adicional, inclusive os em
// desenvolvimento e planejados.
//
// Regras:
// - só o proprietário da plataforma (`manageEstablishmentLifecycle`), com
//   senha confirmada há pouco nesta sessão (`lifecycleActor`), como as rotas
//   de preço que já existiam;
// - nome e descrição mudam na própria linha (`plans` do essencial ou
//   `addon_modules`); o preço continua sendo uma linha NOVA em `plan_prices`
//   ou `addon_module_prices`. Código, recurso (`feature_key`),
//   disponibilidade, vínculos, overrides e versões de assinatura nunca são
//   tocados: renomear não muda o que o item libera, e mudar o preço padrão
//   não reajusta contrato, pagamento nem período;
// - mudança e histórico administrativo (`CATALOG_ITEM_CHANGED`, com os
//   valores anteriores e novos) entram na mesma transação;
// - trava a linha do essencial e todas as linhas de adicionais, nessa ordem
//   (a mesma das rotas de preço), para dois itens nunca ficarem com o mesmo
//   nome e duas telas não gravarem por cima uma da outra.
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { recordAudit } from '../accounts/audit.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import {
  assertUniqueCatalogName,
  planCatalogEdit,
  type CatalogEditPlan,
  type CatalogItemState,
} from '../commercial/catalog-edit.js';
import {
  currentBasePrice,
  ensureModularPlan,
  MODULAR_PLAN_ID,
  MODULAR_PLAN_NAME,
} from '../commercial/modular-plan.js';
import { SubscriptionRuleError } from '../commercial/subscription.js';
import { generateId } from '../entities/common/generate-id.js';
import { reais } from './access-validity.service.js';
import { lifecycleActor } from './establishment-admin.service.js';
import type { CatalogItemDto } from './platform.dto.js';

/** Código do essencial nas respostas e no histórico (nunca colide com um
 * adicional: os códigos de adicional são só maiúsculas e `_`, e este é o id
 * do plano). */
export const ESSENTIAL_ITEM_CODE = MODULAR_PLAN_ID;

export interface CatalogItemView extends CatalogItemState {
  code: string;
  kind: 'ESSENTIAL' | 'ADDON';
}

type Alvo = { kind: 'ESSENTIAL' } | { kind: 'ADDON'; code: string };

interface AddonRow {
  code: string;
  name: string;
  description: string;
}

const preco = (centavos: number | null) => (centavos === null ? 'pendente' : reais(centavos));

/** Resumo do histórico administrativo: o que mudou, de quê para quê. */
export function catalogEditSummary(
  rotulo: string,
  antes: CatalogItemState,
  depois: CatalogItemState,
  plano: Extract<CatalogEditPlan, { kind: 'CHANGE' }>,
): string {
  const partes: string[] = [];
  if (plano.name) partes.push(`nome "${antes.name}" para "${depois.name}"`);
  if (plano.description) partes.push(`descrição "${antes.description}" para "${depois.description}"`);
  if (plano.price) partes.push(`preço mensal padrão ${preco(antes.priceCents)} para ${preco(depois.priceCents)}`);
  return `Catálogo modular, ${rotulo}: ${partes.join('; ')}. Assinaturas já contratadas, pagamentos e períodos não mudam.`;
}

async function addonPrice(manager: EntityManager, code: string): Promise<number | null> {
  const [linha] = await manager.query<{ amount_cents: number }[]>(
    'SELECT amount_cents FROM addon_module_prices WHERE module_code = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1',
    [code],
  );
  return linha ? Number(linha.amount_cents) : null;
}

@Injectable()
export class ModularCatalogService {
  constructor(private readonly dataSource: DataSource) {}

  editEssential(actorId: string, sessionId: string, dto: CatalogItemDto, now = new Date()) {
    return this.edit(actorId, sessionId, { kind: 'ESSENTIAL' }, dto, now);
  }

  editAddon(actorId: string, sessionId: string, code: string, dto: CatalogItemDto, now = new Date()) {
    return this.edit(actorId, sessionId, { kind: 'ADDON', code }, dto, now);
  }

  private async edit(actorId: string, sessionId: string, alvo: Alvo, dto: CatalogItemDto, now: Date) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await lifecycleActor(manager, actorId, sessionId, now);
        // A linha do essencial nasce aqui se ainda não existir (como no
        // primeiro preço base): o nome editado precisa de onde morar.
        if (alvo.kind === 'ESSENTIAL') await ensureModularPlan(manager);
        const [plano] = await manager.query<{ name: string; short_description: string }[]>(
          'SELECT name, short_description FROM plans WHERE id = $1 FOR UPDATE',
          [MODULAR_PLAN_ID],
        );
        const adicionais = await manager.query<AddonRow[]>(
          'SELECT code, name, description FROM addon_modules ORDER BY code FOR UPDATE',
        );

        let atual: CatalogItemState;
        let rotulo: string;
        let outros: { name: string }[];
        if (alvo.kind === 'ESSENTIAL') {
          atual = { name: plano.name, description: plano.short_description, priceCents: await currentBasePrice(manager) };
          rotulo = `essencial (${atual.name})`;
          outros = adicionais;
        } else {
          const modulo = adicionais.find((a) => a.code === alvo.code);
          if (!modulo) throw new NotFoundException('Adicional não encontrado no catálogo.');
          atual = { name: modulo.name, description: modulo.description, priceCents: await addonPrice(manager, modulo.code) };
          rotulo = `adicional ${atual.name} (${modulo.code})`;
          outros = [{ name: plano?.name ?? MODULAR_PLAN_NAME }, ...adicionais.filter((a) => a.code !== modulo.code)];
        }
        const pedido: CatalogItemState = { name: dto.name, description: dto.description, priceCents: dto.priceCents };
        const code = alvo.kind === 'ESSENTIAL' ? ESSENTIAL_ITEM_CODE : alvo.code;
        const vista = (estado: CatalogItemState): CatalogItemView => ({ code, kind: alvo.kind, ...estado });

        let plan: CatalogEditPlan;
        try {
          plan = planCatalogEdit(atual, dto.expected, pedido);
          if (plan.kind === 'CHANGE' && plan.name) assertUniqueCatalogName(pedido.name, outros);
        } catch (erro) {
          if (erro instanceof SubscriptionRuleError) throw new ConflictException({ code: erro.code, message: erro.message });
          throw erro;
        }
        if (plan.kind === 'UNCHANGED') return { changed: false, item: vista(atual) };

        if (plan.name || plan.description) {
          if (alvo.kind === 'ESSENTIAL') {
            await manager.query('UPDATE plans SET name = $2, short_description = $3, updated_at = $4 WHERE id = $1', [
              MODULAR_PLAN_ID,
              pedido.name,
              pedido.description,
              now,
            ]);
          } else {
            await manager.query('UPDATE addon_modules SET name = $2, description = $3 WHERE code = $1', [
              alvo.code,
              pedido.name,
              pedido.description,
            ]);
          }
        }
        if (plan.price && pedido.priceCents !== null) {
          if (alvo.kind === 'ESSENTIAL') {
            await manager.query(
              `INSERT INTO plan_prices (id, plan_id, billing_cycle, amount_cents, reason, recorded_at, recorded_by_user_id, request_key)
               VALUES ($1, $2, 'MONTHLY'::billing_cycle, $3, $4, $5, $6, $7)`,
              [generateId(), MODULAR_PLAN_ID, pedido.priceCents, dto.reason ?? null, now, actor.id, dto.requestKey],
            );
          } else {
            await manager.query(
              `INSERT INTO addon_module_prices (id, module_code, amount_cents, reason, recorded_at, recorded_by_user_id, request_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [generateId(), alvo.code, pedido.priceCents, dto.reason ?? null, now, actor.id, dto.requestKey],
            );
          }
        }
        await recordAudit(
          manager,
          {
            action: 'CATALOG_ITEM_CHANGED',
            actor,
            summary: catalogEditSummary(rotulo, atual, pedido, plan) + (dto.reason ? ` Motivo: ${dto.reason}` : ''),
            previousData: { item: code, ...atual },
            newData: { item: code, ...pedido, reason: dto.reason ?? null },
          },
          now,
        );
        return { changed: true, item: vista(pedido) };
      });
    } catch (erro) {
      // Mesma chave já usada por esta pessoa num preço com outro conteúdo (o
      // mesmo pedido repetido não chega aqui: o estado já é o pedido).
      if (isUniqueViolation(erro, 'uq_plan_prices_request_key') || isUniqueViolation(erro, 'uq_addon_module_prices_request_key')) {
        throw new ConflictException({
          code: 'CHAVE_REPETIDA',
          message: 'Este formulário já foi usado com outro conteúdo. Recarregue a tela.',
        });
      }
      throw erro;
    }
  }
}
