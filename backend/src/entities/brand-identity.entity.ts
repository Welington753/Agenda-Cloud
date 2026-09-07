// Tenant-owned (1:1 com Tenant). Espelha `IdentidadeVisual` em
// src/lib/types.ts. `template` cobre "modelo de página" (2 valores, sem dado
// adicional — por isso campo estruturado, não tabela própria).
//
// Decisão de colunas vs. JSONB (seção 6.3 do plano): cores/endereço/contatos
// ficam em colunas simples (validados individualmente); `photos`/`sectionOrder`
// em array nativo Postgres (lista homogênea, sem estrutura interna); nenhum
// campo desta entidade precisa de JSONB.
//
// `logoUrl` (novo, seção 6.1) e `bannerUrl` guardam sempre uma URL — NUNCA
// Data URL ou binário em produção; upload/object storage ficam para um lote
// futuro (Lote 10), aqui é só a coluna.
import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { PageTemplate } from './enums/page-template.enum.js';
import type { Tenant } from './tenant.entity.js';

@Entity('brand_identities')
export class BrandIdentity {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  shortName!: string;

  @Column({ type: 'varchar' })
  logoInitials!: string;

  @Column({ type: 'varchar' })
  primaryColor!: string;

  @Column({ type: 'varchar' })
  secondaryColor!: string;

  @Column({ type: 'varchar' })
  accentColor!: string;

  @Column({ type: 'varchar' })
  style!: string;

  @Column({ type: 'enum', enum: PageTemplate, enumName: 'page_template', default: PageTemplate.CLASSIC })
  template!: PageTemplate;

  @Column({ type: 'varchar' })
  address!: string;

  @Column({ type: 'varchar' })
  phone!: string;

  @Column({ type: 'varchar', nullable: true })
  email?: string;

  @Column({ type: 'varchar', nullable: true })
  instagram?: string;

  @Column({ type: 'varchar', nullable: true })
  facebook?: string;

  @Column({ type: 'varchar' })
  presentationText!: string;

  @Column({ type: 'text', array: true })
  photos!: string[];

  @Column({ type: 'varchar', nullable: true })
  bannerUrl?: string;

  // Novo (seção 3.2/6.1) — URL do logo enviado. Ausente = usa `logoInitials`
  // como fallback (mesma regra de `resolverLogo` em
  // src/components/publico/secoes.ts).
  @Column({ type: 'varchar', nullable: true })
  logoUrl?: string;

  // Lista ordenada de um conjunto fixo e pequeno de valores ("apresentacao" |
  // "servicos" | "equipe" | "fotos", ver SecaoId em
  // src/components/publico/secoes.ts) — validação de conteúdo é
  // responsabilidade do serviço (seção 6.3), não do banco.
  @Column({ type: 'text', array: true })
  sectionOrder!: string[];

  @Column({ type: 'varchar', nullable: true })
  customFooter?: string;

  @Column({ type: 'boolean', default: false })
  hidePlatformBranding!: boolean;

  @OneToOne('Tenant', (tenant: Tenant) => tenant.brandIdentity, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
