// Tenant-owned. Junção M:N explícita — substitui os arrays paralelos
// `Profissional.servicosIds`/`Servico.profissionaisIds` em src/lib/types.ts.
//
// `tenantId` explicitamente exigido pela tarefa ("vínculo profissional-serviço"
// deve possuir tenant_id) — adição desta execução além do mapeamento original
// da seção 3.2 (que só tinha `professionalId`/`serviceId`). Denormalizado a
// partir de `Professional.tenantId`/`Service.tenantId`, que devem sempre
// coincidir — proteção real (constraint composta) fica para SQL manual no
// Lote 5 (ver seção 5 do plano); aqui só a coluna e o índice.
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Professional } from './professional.entity.js';
import type { Service } from './service.entity.js';

@Entity('professional_services')
@Unique(['tenantId', 'professionalId', 'serviceId'])
export class ProfessionalService {
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

  @ManyToOne('Professional', (professional: Professional) => professional.services, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'professional_id' })
  professional!: Professional;

  @ManyToOne('Service', (service: Service) => service.professionals, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'service_id' })
  service!: Service;
}
