// Nova (seção 5.1). Espelha `RegraComissao` em src/lib/types.ts — no máximo
// uma regra ativa por (tenant, profissional, serviço), garantida pela
// unicidade composta (mesma disciplina de
// `comissaoRegraRepository.salvar` no frontend, que faz upsert por essa
// chave).
//
// UNIDADE DE `value` (revisada — correção pós-Lote 3, nunca float para
// dinheiro/percentual):
//   - `type = PERCENTAGE`: pontos-base inteiros, nunca fração/decimal.
//     100% = 10000, 40% = 4000, 12,5% = 1250, 0,01% = 1. Faixa válida:
//     0-10000 inclusive. O frontend guarda percentual como 0-100 "humano"
//     (`RegraComissao.valor` em src/lib/types.ts) — a conversão para
//     pontos-base (×100) é responsabilidade do serviço/DTO que grava esta
//     entidade (lote posterior), nunca feita aqui.
//   - `type = FIXED`: centavos inteiros, >= 0 (mesma unidade de
//     `Service.priceCents`).
// O futuro `CHECK` do Lote 5 (SQL manual, não criado aqui) precisa impor:
// `(type = 'PERCENTAGE' AND value BETWEEN 0 AND 10000) OR (type = 'FIXED'
// AND value >= 0)` — não expressável por decorator do TypeORM porque depende
// do valor de outra coluna da mesma linha (`type`), não é validação de
// intervalo fixo.
//
// Validações replicadas do frontend (`validarRegraComissao`,
// src/lib/comissoes/engine.ts) — profissional/serviço mesmo tenant, serviço
// realmente vinculado ao profissional via `ProfessionalService`, faixa de
// valor por tipo — ficam para o serviço de domínio (lote posterior); a
// checagem "serviço vinculado ao profissional" depende de outra tabela, não
// expressável em CHECK simples de coluna.
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { CommissionType } from './enums/commission-type.enum.js';
import type { Professional } from './professional.entity.js';
import type { Service } from './service.entity.js';
import type { Tenant } from './tenant.entity.js';

@Entity('commission_rules')
@Unique(['tenantId', 'professionalId', 'serviceId'])
export class CommissionRule {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  // Sem índice avulso aqui — a unicidade composta
  // (tenantId, professionalId, serviceId) abaixo já cobre `WHERE tenant_id =
  // $1` sozinho pelo prefixo esquerdo; um índice extra só em tenantId seria
  // redundante.
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  professionalId!: string;

  @Column({ type: 'varchar', length: 30 })
  serviceId!: string;

  @Column({ type: 'enum', enum: CommissionType, enumName: 'commission_type' })
  type!: CommissionType;

  // PERCENTAGE: pontos-base inteiros, 0-10000 (100% = 10000, 40% = 4000,
  // 12,5% = 1250, 0,01% = 1). FIXED: centavos inteiros, >= 0. Nunca float.
  // Ver nota de unidade no cabeçalho do arquivo.
  @Column({ type: 'int' })
  value!: number;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.commissionRules, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne('Professional', (professional: Professional) => professional.commissionRules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'professional_id' })
  professional!: Professional;

  @ManyToOne('Service', (service: Service) => service.commissionRules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'service_id' })
  service!: Service;
}
