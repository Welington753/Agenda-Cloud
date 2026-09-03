// Nova (seção 5.1). Espelha `RegraComissao` em src/lib/types.ts — no máximo
// uma regra ativa por (tenant, profissional, serviço), garantida pela
// unicidade composta (mesma disciplina de
// `comissaoRegraRepository.salvar` no frontend, que faz upsert por essa
// chave). `value`: percentual 0-100 inteiro (não fração), fixo em centavos.
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
  Index,
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

  @Index()
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  professionalId!: string;

  @Column({ type: 'varchar', length: 30 })
  serviceId!: string;

  @Column({ type: 'enum', enum: CommissionType })
  type!: CommissionType;

  // Percentual: inteiro 0-100 (não fração). Fixo: centavos inteiro.
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
