// Produtos do estoque. O cadastro nunca mexe no saldo: o saldo só muda por
// movimentação (stock-ledger.ts), e o saldo inicial informado na criação é
// a primeira movimentação (`SALDO_INICIAL`), na mesma transação.
//
// Vínculo: categoria obrigatória e ativa; subcategoria opcional, ativa e DA
// MESMA categoria e estabelecimento. Conferido com as duas travadas
// (`FOR SHARE`, contra o arquivamento em paralelo) e garantido no banco pelas
// FKs compostas `fk_stock_products_category` e
// `fk_stock_products_subcategory`.
//
// Unidade: só muda antes da primeira movimentação (`balance_version = 0`).
// Edição: a tela manda o `updatedAt` que leu; se outra tela mudou o cadastro
// depois, 409 `TELA_DESATUALIZADA`.
//
// Preço sugerido de venda (`sale_price_cents`, docs/plans/vendas-v1.md):
// nulo = sem preço sugerido, nunca zero. Na edição, o campo omitido mantém o
// preço gravado (a tela anterior ao campo não o apaga); `null` tira.
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { linhasDe } from '../common/linhas-de.js';
import { generateId } from '../entities/common/generate-id.js';
import {
  CHAVE_EM_USO,
  LIMITE_DA_PAGINA,
  autorizarConsulta,
  autorizarOperacao,
  codificarCursor,
  conferirRepeticao,
  conflito,
  decodificarCursor,
  iso,
  numero,
  termoDeBusca,
} from './stock-common.js';
import { registrarMovimentacao, travarProduto } from './stock-ledger.js';
import { estoqueBaixo, type StockPurpose, type StockUnit } from './stock-quantity.js';
import { impressaoDoProduto } from './stock-request-fingerprint.js';
import type { CreateProductDto, ProductListQueryDto, UpdateProductDto } from './stock.dto.js';

export interface ProductView {
  id: string;
  name: string;
  description: string | null;
  internalCode: string | null;
  categoryId: string;
  categoryName: string;
  subcategoryId: string | null;
  subcategoryName: string | null;
  purpose: StockPurpose;
  unit: StockUnit;
  minQuantityMilli: number;
  /** Preço sugerido de venda; `null` = sem preço sugerido (nunca zero). */
  salePriceCents: number | null;
  balanceMilli: number;
  balanceVersion: number;
  low: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProdutoRow {
  id: string;
  name: string;
  description: string | null;
  internal_code: string | null;
  category_id: string;
  category_name: string;
  subcategory_id: string | null;
  subcategory_name: string | null;
  purpose: StockPurpose;
  unit: StockUnit;
  min_quantity_milli: string;
  sale_price_cents: string | null;
  balance_milli: string;
  balance_version: number;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_PRODUTO = `SELECT p.id, p.name, p.description, p.internal_code, p.category_id, c.name AS category_name,
    p.subcategory_id, s.name AS subcategory_name, p.purpose, p.unit, p.min_quantity_milli::text AS min_quantity_milli,
    p.sale_price_cents::text AS sale_price_cents, p.balance_milli::text AS balance_milli, p.balance_version, p.archived_at, p.created_at, p.updated_at
  FROM stock_products p
  JOIN stock_categories c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
  LEFT JOIN stock_subcategories s ON s.tenant_id = p.tenant_id AND s.id = p.subcategory_id`;

export function toProductView(l: ProdutoRow): ProductView {
  const saldo = numero(l.balance_milli);
  const minimo = numero(l.min_quantity_milli);
  return {
    id: l.id,
    name: l.name,
    description: l.description,
    internalCode: l.internal_code,
    categoryId: l.category_id,
    categoryName: l.category_name,
    subcategoryId: l.subcategory_id,
    subcategoryName: l.subcategory_name,
    purpose: l.purpose,
    unit: l.unit,
    minQuantityMilli: minimo,
    salePriceCents: l.sale_price_cents === null ? null : Number(l.sale_price_cents),
    balanceMilli: saldo,
    balanceVersion: Number(l.balance_version),
    low: estoqueBaixo(saldo, minimo),
    archived: l.archived_at !== null,
    createdAt: iso(l.created_at)!,
    updatedAt: iso(l.updated_at)!,
  };
}

const CODIGO_EM_USO = () => conflito('CODIGO_EM_USO', 'Já existe um produto com esse código interno.');

@Injectable()
export class StockProductsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(userId: string, tenantId: string, query: ProductListQueryDto): Promise<{ products: ProductView[]; nextCursor: string | null }> {
    const autorizado = await autorizarConsulta(this.dataSource.manager, userId, tenantId);
    const filtros = ['p.tenant_id = $1'];
    const params: unknown[] = [autorizado.tenantId];
    const parametro = (valor: unknown) => {
      params.push(valor);
      return `$${params.length}`;
    };
    if (query.status === 'ACTIVE') filtros.push('p.archived_at IS NULL');
    if (query.status === 'ARCHIVED') filtros.push('p.archived_at IS NOT NULL');
    if (query.categoryId) filtros.push(`p.category_id = ${parametro(query.categoryId)}`);
    if (query.subcategoryId) filtros.push(`p.subcategory_id = ${parametro(query.subcategoryId)}`);
    if (query.q) {
      const termo = parametro(termoDeBusca(query.q));
      filtros.push(`(p.name ILIKE ${termo} OR p.internal_code ILIKE ${termo})`);
    }
    if (query.low) filtros.push('p.min_quantity_milli > 0 AND p.balance_milli <= p.min_quantity_milli');
    const cursor = decodificarCursor(query.cursor, 2);
    if (cursor) filtros.push(`(lower(p.name), p.id) > (${parametro(cursor[0])}, ${parametro(cursor[1])})`);
    const linhas = linhasDe<ProdutoRow & { sort_name: string }>(
      await this.dataSource.manager.query(
        `${SELECT_PRODUTO.replace('SELECT p.id,', 'SELECT lower(p.name) AS sort_name, p.id,')} WHERE ${filtros.join(' AND ')} ORDER BY lower(p.name), p.id LIMIT ${LIMITE_DA_PAGINA + 1}`,
        params,
      ),
    );
    const pagina = linhas.slice(0, LIMITE_DA_PAGINA);
    const ultimo = pagina.at(-1);
    return {
      products: pagina.map(toProductView),
      nextCursor: linhas.length > LIMITE_DA_PAGINA && ultimo ? codificarCursor([ultimo.sort_name, ultimo.id]) : null,
    };
  }

  async get(userId: string, tenantId: string, productId: string): Promise<ProductView> {
    const autorizado = await autorizarConsulta(this.dataSource.manager, userId, tenantId);
    return this.porId(this.dataSource.manager, autorizado.tenantId, productId);
  }

  async create(userId: string, tenantId: string, dto: CreateProductDto, now = new Date()): Promise<{ created: boolean; product: ProductView }> {
    const autorizado = await autorizarOperacao(this.dataSource.manager, userId, tenantId);
    const impressao = impressaoDoProduto(dto);
    const repetido = await this.porChave(this.dataSource.manager, autorizado.tenantId, userId, dto.requestKey);
    if (repetido) return { created: false, product: conferirRepeticao(repetido, impressao) };
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const t = (await autorizarOperacao(manager, userId, tenantId)).tenantId;
        await this.conferirVinculo(manager, t, dto.categoryId, dto.subcategoryId);
        const novo = generateId();
        await manager.query(
          `INSERT INTO stock_products (id, tenant_id, category_id, subcategory_id, name, description, internal_code, purpose,
              unit, min_quantity_milli, created_at, updated_at, created_by_user_id, request_key, request_fingerprint, sale_price_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13, $14, $15)`,
          [
            novo,
            t,
            dto.categoryId,
            dto.subcategoryId,
            dto.name,
            dto.description,
            dto.internalCode,
            dto.purpose,
            dto.unit,
            dto.minQuantityMilli,
            now,
            userId,
            dto.requestKey,
            impressao,
            dto.salePriceCents ?? null,
          ],
        );
        if (dto.initialQuantityMilli) {
          const produto = await travarProduto(manager, t, novo);
          await registrarMovimentacao(manager, {
            tenantId: t,
            produto,
            kind: 'SALDO_INICIAL',
            deltaMilli: dto.initialQuantityMilli,
            reason: null,
            userId,
            now,
          });
        }
        await this.auditar(manager, userId, t, now, `Produto de estoque "${dto.name}" cadastrado.`, null, {
          productId: novo,
          ...camposAuditados(dto),
          initialQuantityMilli: dto.initialQuantityMilli ?? 0,
        });
        return novo;
      });
      return { created: true, product: await this.porId(this.dataSource.manager, autorizado.tenantId, id) };
    } catch (error) {
      if (isUniqueViolation(error, 'uq_stock_products_request_key')) {
        const outro = await this.porChave(this.dataSource.manager, autorizado.tenantId, userId, dto.requestKey);
        if (outro) return { created: false, product: conferirRepeticao(outro, impressao) };
        throw CHAVE_EM_USO();
      }
      if (isUniqueViolation(error, 'uq_stock_products_internal_code')) throw CODIGO_EM_USO();
      throw error;
    }
  }

  async update(userId: string, tenantId: string, productId: string, dto: UpdateProductDto, now = new Date()): Promise<ProductView> {
    try {
      const t = await this.dataSource.transaction(async (manager) => {
        const tenant = (await autorizarOperacao(manager, userId, tenantId)).tenantId;
        const atual = await this.travarCadastro(manager, tenant, productId);
        if (new Date(atual.updated_at).getTime() !== new Date(dto.expectedUpdatedAt).getTime()) {
          throw conflito('TELA_DESATUALIZADA', 'O produto foi alterado em outra tela. Recarregue antes de salvar.');
        }
        if (atual.archived_at) throw conflito('PRODUTO_ARQUIVADO', 'Reative o produto antes de editar o cadastro.');
        if (dto.unit !== atual.unit && Number(atual.balance_version) > 0) {
          throw conflito('UNIDADE_TRAVADA', 'A unidade só pode mudar antes da primeira movimentação do produto.');
        }
        if (dto.categoryId !== atual.category_id || dto.subcategoryId !== atual.subcategory_id) {
          await this.conferirVinculo(manager, tenant, dto.categoryId, dto.subcategoryId);
        }
        // Preço sugerido: omitido no corpo (tela anterior ao campo) mantém o
        // gravado; `null` tira. Ausência de preço nunca vira zero.
        const preco = dto.salePriceCents === undefined ? cadastroDaLinha(atual).salePriceCents : dto.salePriceCents;
        await manager.query(
          `UPDATE stock_products SET name = $3, description = $4, internal_code = $5, category_id = $6, subcategory_id = $7,
              purpose = $8, unit = $9, min_quantity_milli = $10, updated_at = $11, sale_price_cents = $12
            WHERE tenant_id = $1 AND id = $2`,
          [tenant, productId, dto.name, dto.description, dto.internalCode, dto.categoryId, dto.subcategoryId, dto.purpose, dto.unit, dto.minQuantityMilli, now, preco],
        );
        await this.auditar(
          manager,
          userId,
          tenant,
          now,
          `Cadastro do produto de estoque "${dto.name}" alterado.`,
          { productId, ...camposAuditados(cadastroDaLinha(atual)) },
          { productId, ...camposAuditados({ ...dto, salePriceCents: preco }) },
        );
        return tenant;
      });
      return this.porId(this.dataSource.manager, t, productId);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_stock_products_internal_code')) throw CODIGO_EM_USO();
      throw error;
    }
  }

  async archive(userId: string, tenantId: string, productId: string, now = new Date()): Promise<ProductView> {
    const t = await this.dataSource.transaction(async (manager) => {
      const tenant = (await autorizarOperacao(manager, userId, tenantId)).tenantId;
      const atual = await this.travarCadastro(manager, tenant, productId);
      if (atual.archived_at) return tenant;
      await manager.query(`UPDATE stock_products SET archived_at = $3, updated_at = $3 WHERE tenant_id = $1 AND id = $2`, [tenant, productId, now]);
      await this.auditar(manager, userId, tenant, now, `Produto de estoque "${atual.name}" arquivado (saldo preservado).`, { productId, archived: false }, {
        productId,
        archived: true,
        balanceMilli: numero(atual.balance_milli),
      });
      return tenant;
    });
    return this.porId(this.dataSource.manager, t, productId);
  }

  async reactivate(userId: string, tenantId: string, productId: string, now = new Date()): Promise<ProductView> {
    const t = await this.dataSource.transaction(async (manager) => {
      const tenant = (await autorizarOperacao(manager, userId, tenantId)).tenantId;
      const atual = await this.travarCadastro(manager, tenant, productId);
      if (!atual.archived_at) return tenant;
      await this.conferirVinculo(manager, tenant, atual.category_id, atual.subcategory_id);
      await manager.query(`UPDATE stock_products SET archived_at = NULL, updated_at = $3 WHERE tenant_id = $1 AND id = $2`, [tenant, productId, now]);
      await this.auditar(manager, userId, tenant, now, `Produto de estoque "${atual.name}" reativado.`, { productId, archived: true }, { productId, archived: false });
      return tenant;
    });
    return this.porId(this.dataSource.manager, t, productId);
  }

  /** Categoria ativa do estabelecimento e, se houver, subcategoria ativa
   * dela. Travadas para o arquivamento em paralelo esperar. */
  private async conferirVinculo(manager: EntityManager, tenantId: string, categoryId: string, subcategoryId: string | null) {
    const [categoria] = linhasDe<{ archived_at: Date | null }>(
      await manager.query(`SELECT archived_at FROM stock_categories WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [tenantId, categoryId]),
    );
    if (!categoria) throw conflito('CATEGORIA_INVALIDA', 'Categoria não encontrada neste estabelecimento.');
    if (categoria.archived_at) throw conflito('CATEGORIA_ARQUIVADA', 'A categoria escolhida está arquivada.');
    if (subcategoryId === null) return;
    const [sub] = linhasDe<{ category_id: string; archived_at: Date | null }>(
      await manager.query(`SELECT category_id, archived_at FROM stock_subcategories WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [
        tenantId,
        subcategoryId,
      ]),
    );
    if (!sub || sub.category_id !== categoryId) {
      throw conflito('SUBCATEGORIA_INCOMPATIVEL', 'A subcategoria escolhida não pertence a esta categoria.');
    }
    if (sub.archived_at) throw conflito('CATEGORIA_ARQUIVADA', 'A subcategoria escolhida está arquivada.');
  }

  private async travarCadastro(manager: EntityManager, tenantId: string, productId: string) {
    const [linha] = linhasDe<ProdutoRow>(
      await manager.query(`${SELECT_PRODUTO} WHERE p.tenant_id = $1 AND p.id = $2 FOR UPDATE OF p`, [tenantId, productId]),
    );
    if (!linha) throw new NotFoundException('Produto não encontrado.');
    return linha;
  }

  private async porId(manager: EntityManager, tenantId: string, productId: string): Promise<ProductView> {
    const [linha] = linhasDe<ProdutoRow>(await manager.query(`${SELECT_PRODUTO} WHERE p.tenant_id = $1 AND p.id = $2`, [tenantId, productId]));
    if (!linha) throw new NotFoundException('Produto não encontrado.');
    return toProductView(linha);
  }

  private async porChave(manager: EntityManager, tenantId: string, userId: string, chave: string) {
    const [linha] = linhasDe<ProdutoRow & { request_fingerprint: string }>(
      await manager.query(
        `${SELECT_PRODUTO.replace('SELECT p.id,', 'SELECT p.request_fingerprint, p.id,')}
          WHERE p.tenant_id = $1 AND p.created_by_user_id = $2 AND p.request_key = $3`,
        [tenantId, userId, chave],
      ),
    );
    return linha ? { fingerprint: linha.request_fingerprint, value: toProductView(linha) } : null;
  }

  private async auditar(
    manager: EntityManager,
    userId: string,
    tenantId: string,
    now: Date,
    summary: string,
    previousData: Record<string, unknown> | null,
    newData: Record<string, unknown>,
  ) {
    await recordAudit(
      manager,
      { action: 'STOCK_PRODUCT_CHANGED', actor: await loadActor(manager, userId), tenantId, summary, previousData, newData },
      now,
    );
  }
}

interface Cadastro {
  name: string;
  description: string | null;
  internalCode: string | null;
  categoryId: string;
  subcategoryId: string | null;
  purpose: string;
  unit: string;
  minQuantityMilli: number;
  salePriceCents?: number | null;
}

function cadastroDaLinha(l: ProdutoRow): Cadastro {
  return {
    name: l.name,
    description: l.description,
    internalCode: l.internal_code,
    categoryId: l.category_id,
    subcategoryId: l.subcategory_id,
    purpose: l.purpose,
    unit: l.unit,
    minQuantityMilli: numero(l.min_quantity_milli),
    salePriceCents: l.sale_price_cents === null ? null : Number(l.sale_price_cents),
  };
}

function camposAuditados(c: Cadastro) {
  return {
    name: c.name,
    internalCode: c.internalCode,
    categoryId: c.categoryId,
    subcategoryId: c.subcategoryId,
    purpose: c.purpose,
    unit: c.unit,
    minQuantityMilli: c.minQuantityMilli,
    salePriceCents: c.salePriceCents ?? null,
  };
}
