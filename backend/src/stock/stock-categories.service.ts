// Categorias e subcategorias do estoque (um nível de subcategoria). Cada
// estabelecimento tem as suas; nada é apagado, só arquivado.
//
// Regras:
// - nome único por estabelecimento (categoria) e por categoria
//   (subcategoria), sem diferenciar maiúsculas, arquivadas incluídas;
// - categoria ou subcategoria com produto ATIVO vinculado não é arquivada
//   (409 `CATEGORIA_COM_PRODUTOS`, com a contagem): o produto ficaria com
//   vínculo inválido. A trava `FOR UPDATE` na categoria serializa o
//   arquivamento com a gravação de produto (que trava `FOR SHARE`);
// - arquivar a categoria arquiva junto as subcategorias dela (também sem
//   produto ativo); reativar a categoria não reativa as subcategorias;
// - subcategoria nunca muda de categoria; reativá-la exige a categoria ativa.
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { linhasDe } from '../common/linhas-de.js';
import { generateId } from '../entities/common/generate-id.js';
import { autorizarConsulta, autorizarOperacao, conflito, iso, numero } from './stock-common.js';
import type { CategoryListQueryDto, CategoryNameDto } from './stock.dto.js';

export interface SubcategoryView {
  id: string;
  categoryId: string;
  name: string;
  archived: boolean;
  activeProducts: number;
}

export interface CategoryView {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  activeProducts: number;
  subcategories: SubcategoryView[];
}

const NOME_DA_CATEGORIA_EM_USO = () => conflito('NOME_EM_USO', 'Já existe uma categoria com esse nome.');
const NOME_DA_SUBCATEGORIA_EM_USO = () => conflito('NOME_EM_USO', 'Já existe uma subcategoria com esse nome nesta categoria.');
const CATEGORIA_NAO_ENCONTRADA = () => new NotFoundException('Categoria não encontrada.');
const SUBCATEGORIA_NAO_ENCONTRADA = () => new NotFoundException('Subcategoria não encontrada.');

interface CategoriaRow {
  id: string;
  name: string;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  active_products: string;
}

interface SubcategoriaRow {
  id: string;
  category_id: string;
  name: string;
  archived_at: Date | null;
  active_products: string;
}

@Injectable()
export class StockCategoriesService {
  constructor(private readonly dataSource: DataSource) {}

  async list(userId: string, tenantId: string, query: CategoryListQueryDto): Promise<{ categories: CategoryView[] }> {
    const autorizado = await autorizarConsulta(this.dataSource.manager, userId, tenantId);
    return { categories: await this.lerCategorias(this.dataSource.manager, autorizado.tenantId, query.status) };
  }

  async create(userId: string, tenantId: string, dto: CategoryNameDto, now = new Date()): Promise<CategoryView> {
    return this.gravar(userId, tenantId, NOME_DA_CATEGORIA_EM_USO, async (manager, t) => {
      const id = generateId();
      await manager.query(
        `INSERT INTO stock_categories (id, tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
        [id, t, dto.name, now],
      );
      await this.auditar(manager, userId, t, now, `Categoria de estoque "${dto.name}" criada.`, null, { categoryId: id, name: dto.name });
      return id;
    });
  }

  async rename(userId: string, tenantId: string, categoryId: string, dto: CategoryNameDto, now = new Date()): Promise<CategoryView> {
    return this.gravar(userId, tenantId, NOME_DA_CATEGORIA_EM_USO, async (manager, t) => {
      const atual = await this.travarCategoria(manager, t, categoryId, 'FOR UPDATE');
      if (atual.name !== dto.name) {
        await manager.query(`UPDATE stock_categories SET name = $3, updated_at = $4 WHERE tenant_id = $1 AND id = $2`, [
          t,
          categoryId,
          dto.name,
          now,
        ]);
        await this.auditar(manager, userId, t, now, `Categoria de estoque renomeada para "${dto.name}".`, { categoryId, name: atual.name }, { categoryId, name: dto.name });
      }
      return categoryId;
    });
  }

  async archive(userId: string, tenantId: string, categoryId: string, now = new Date()): Promise<CategoryView> {
    return this.gravar(userId, tenantId, NOME_DA_CATEGORIA_EM_USO, async (manager, t) => {
      const atual = await this.travarCategoria(manager, t, categoryId, 'FOR UPDATE');
      if (atual.archived_at) return categoryId;
      const ativos = await this.produtosAtivos(manager, t, 'category_id', categoryId);
      if (ativos > 0) throw categoriaComProdutos(ativos);
      await manager.query(
        `UPDATE stock_subcategories SET archived_at = $3, updated_at = $3 WHERE tenant_id = $1 AND category_id = $2 AND archived_at IS NULL`,
        [t, categoryId, now],
      );
      await manager.query(`UPDATE stock_categories SET archived_at = $3, updated_at = $3 WHERE tenant_id = $1 AND id = $2`, [t, categoryId, now]);
      await this.auditar(manager, userId, t, now, `Categoria de estoque "${atual.name}" arquivada.`, { categoryId, archived: false }, { categoryId, archived: true });
      return categoryId;
    });
  }

  async reactivate(userId: string, tenantId: string, categoryId: string, now = new Date()): Promise<CategoryView> {
    return this.gravar(userId, tenantId, NOME_DA_CATEGORIA_EM_USO, async (manager, t) => {
      const atual = await this.travarCategoria(manager, t, categoryId, 'FOR UPDATE');
      if (!atual.archived_at) return categoryId;
      await manager.query(`UPDATE stock_categories SET archived_at = NULL, updated_at = $3 WHERE tenant_id = $1 AND id = $2`, [t, categoryId, now]);
      await this.auditar(manager, userId, t, now, `Categoria de estoque "${atual.name}" reativada.`, { categoryId, archived: true }, { categoryId, archived: false });
      return categoryId;
    });
  }

  async createSubcategory(userId: string, tenantId: string, categoryId: string, dto: CategoryNameDto, now = new Date()): Promise<CategoryView> {
    return this.gravar(userId, tenantId, NOME_DA_SUBCATEGORIA_EM_USO, async (manager, t) => {
      const categoria = await this.travarCategoria(manager, t, categoryId, 'FOR SHARE');
      if (categoria.archived_at) throw conflito('CATEGORIA_ARQUIVADA', 'Reative a categoria antes de criar subcategorias nela.');
      const id = generateId();
      await manager.query(
        `INSERT INTO stock_subcategories (id, tenant_id, category_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
        [id, t, categoryId, dto.name, now],
      );
      await this.auditar(manager, userId, t, now, `Subcategoria de estoque "${dto.name}" criada.`, null, { categoryId, subcategoryId: id, name: dto.name });
      return categoryId;
    });
  }

  async renameSubcategory(userId: string, tenantId: string, subcategoryId: string, dto: CategoryNameDto, now = new Date()): Promise<CategoryView> {
    return this.gravar(userId, tenantId, NOME_DA_SUBCATEGORIA_EM_USO, async (manager, t) => {
      const atual = await this.travarSubcategoria(manager, t, subcategoryId);
      if (atual.name !== dto.name) {
        await manager.query(`UPDATE stock_subcategories SET name = $3, updated_at = $4 WHERE tenant_id = $1 AND id = $2`, [
          t,
          subcategoryId,
          dto.name,
          now,
        ]);
        await this.auditar(manager, userId, t, now, `Subcategoria de estoque renomeada para "${dto.name}".`, { subcategoryId, name: atual.name }, { subcategoryId, name: dto.name });
      }
      return atual.category_id;
    });
  }

  async archiveSubcategory(userId: string, tenantId: string, subcategoryId: string, now = new Date()): Promise<CategoryView> {
    return this.gravar(userId, tenantId, NOME_DA_SUBCATEGORIA_EM_USO, async (manager, t) => {
      const atual = await this.travarSubcategoria(manager, t, subcategoryId);
      if (atual.archived_at) return atual.category_id;
      const ativos = await this.produtosAtivos(manager, t, 'subcategory_id', subcategoryId);
      if (ativos > 0) throw categoriaComProdutos(ativos);
      await manager.query(`UPDATE stock_subcategories SET archived_at = $3, updated_at = $3 WHERE tenant_id = $1 AND id = $2`, [t, subcategoryId, now]);
      await this.auditar(manager, userId, t, now, `Subcategoria de estoque "${atual.name}" arquivada.`, { subcategoryId, archived: false }, { subcategoryId, archived: true });
      return atual.category_id;
    });
  }

  async reactivateSubcategory(userId: string, tenantId: string, subcategoryId: string, now = new Date()): Promise<CategoryView> {
    return this.gravar(userId, tenantId, NOME_DA_SUBCATEGORIA_EM_USO, async (manager, t) => {
      const atual = await this.travarSubcategoria(manager, t, subcategoryId);
      if (!atual.archived_at) return atual.category_id;
      const categoria = await this.travarCategoria(manager, t, atual.category_id, 'FOR SHARE');
      if (categoria.archived_at) throw conflito('CATEGORIA_ARQUIVADA', 'Reative a categoria antes de reativar a subcategoria.');
      await manager.query(`UPDATE stock_subcategories SET archived_at = NULL, updated_at = $3 WHERE tenant_id = $1 AND id = $2`, [t, subcategoryId, now]);
      await this.auditar(manager, userId, t, now, `Subcategoria de estoque "${atual.name}" reativada.`, { subcategoryId, archived: true }, { subcategoryId, archived: false });
      return atual.category_id;
    });
  }

  /** Autoriza dentro da transação, grava e devolve a categoria atualizada.
   * Nome repetido (índice único) vira 409. */
  private async gravar(
    userId: string,
    tenantId: string,
    nomeEmUso: () => Error,
    acao: (manager: EntityManager, tenantId: string) => Promise<string>,
  ): Promise<CategoryView> {
    try {
      const { tenant, categoryId } = await this.dataSource.transaction(async (manager) => {
        const autorizado = await autorizarOperacao(manager, userId, tenantId);
        return { tenant: autorizado.tenantId, categoryId: await acao(manager, autorizado.tenantId) };
      });
      const [categoria] = (await this.lerCategorias(this.dataSource.manager, tenant, 'ALL', categoryId));
      if (!categoria) throw CATEGORIA_NAO_ENCONTRADA();
      return categoria;
    } catch (error) {
      if (isUniqueViolation(error, 'uq_stock_categories_name') || isUniqueViolation(error, 'uq_stock_subcategories_name')) {
        throw nomeEmUso();
      }
      throw error;
    }
  }

  private async travarCategoria(manager: EntityManager, tenantId: string, id: string, trava: 'FOR UPDATE' | 'FOR SHARE') {
    const [linha] = linhasDe<{ name: string; archived_at: Date | null }>(
      await manager.query(`SELECT name, archived_at FROM stock_categories WHERE tenant_id = $1 AND id = $2 ${trava}`, [tenantId, id]),
    );
    if (!linha) throw CATEGORIA_NAO_ENCONTRADA();
    return linha;
  }

  private async travarSubcategoria(manager: EntityManager, tenantId: string, id: string) {
    const [linha] = linhasDe<{ category_id: string; name: string; archived_at: Date | null }>(
      await manager.query(
        `SELECT category_id, name, archived_at FROM stock_subcategories WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      ),
    );
    if (!linha) throw SUBCATEGORIA_NAO_ENCONTRADA();
    return linha;
  }

  private async produtosAtivos(manager: EntityManager, tenantId: string, coluna: 'category_id' | 'subcategory_id', id: string) {
    const [linha] = linhasDe<{ total: number }>(
      await manager.query(
        `SELECT count(*)::int AS total FROM stock_products WHERE tenant_id = $1 AND ${coluna} = $2 AND archived_at IS NULL`,
        [tenantId, id],
      ),
    );
    return linha?.total ?? 0;
  }

  private async lerCategorias(
    manager: EntityManager,
    tenantId: string,
    status: 'ACTIVE' | 'ARCHIVED' | 'ALL',
    somente?: string,
  ): Promise<CategoryView[]> {
    const filtros = ['c.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (somente) {
      params.push(somente);
      filtros.push(`c.id = $${params.length}`);
    } else if (status === 'ACTIVE') filtros.push('c.archived_at IS NULL');
    else if (status === 'ARCHIVED') filtros.push('c.archived_at IS NOT NULL');
    const categorias = linhasDe<CategoriaRow>(
      await manager.query(
        `SELECT c.id, c.name, c.archived_at, c.created_at, c.updated_at,
                (SELECT count(*) FROM stock_products p WHERE p.tenant_id = c.tenant_id AND p.category_id = c.id
                   AND p.archived_at IS NULL)::text AS active_products
           FROM stock_categories c WHERE ${filtros.join(' AND ')}
          ORDER BY c.archived_at IS NOT NULL, lower(c.name), c.id`,
        params,
      ),
    );
    if (categorias.length === 0) return [];
    const subcategorias = linhasDe<SubcategoriaRow>(
      await manager.query(
        `SELECT s.id, s.category_id, s.name, s.archived_at,
                (SELECT count(*) FROM stock_products p WHERE p.tenant_id = s.tenant_id AND p.subcategory_id = s.id
                   AND p.archived_at IS NULL)::text AS active_products
           FROM stock_subcategories s WHERE s.tenant_id = $1 AND s.category_id = ANY($2::varchar[])
          ORDER BY s.archived_at IS NOT NULL, lower(s.name), s.id`,
        [tenantId, categorias.map((c) => c.id)],
      ),
    );
    return categorias.map((c) => ({
      id: c.id,
      name: c.name,
      archived: c.archived_at !== null,
      createdAt: iso(c.created_at)!,
      updatedAt: iso(c.updated_at)!,
      activeProducts: numero(c.active_products),
      subcategories: subcategorias
        .filter((s) => s.category_id === c.id)
        .map((s) => ({
          id: s.id,
          categoryId: s.category_id,
          name: s.name,
          archived: s.archived_at !== null,
          activeProducts: numero(s.active_products),
        })),
    }));
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
      { action: 'STOCK_CATEGORY_CHANGED', actor: await loadActor(manager, userId), tenantId, summary, previousData, newData },
      now,
    );
  }
}

function categoriaComProdutos(ativos: number) {
  return conflito(
    'CATEGORIA_COM_PRODUTOS',
    ativos === 1
      ? 'Há 1 produto ativo nesta categoria. Arquive-o ou mude a categoria dele antes.'
      : `Há ${ativos} produtos ativos nesta categoria. Arquive-os ou mude a categoria deles antes.`,
    { activeProducts: ativos },
  );
}
