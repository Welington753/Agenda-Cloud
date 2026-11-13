// Manifesto das migrations que ESTE código exige no banco.
//
// O runtime não carrega migrations (`migrations: []` em
// runtime-data-source.ts) e nunca as executa. Este arquivo existe só para a
// conferência de inicialização (schema-readiness.ts) saber quais nomes
// precisam estar em `typeorm_migrations` antes de a API aceitar tráfego.
//
// Imports ESTÁTICOS, de propósito: o que vai para o `dist` de produção é
// exatamente esta lista, sem glob em tempo de execução. Um arquivo de
// migration que faltasse quebraria o build, em vez de reduzir a exigência em
// silêncio. O nome vem da própria classe (`name`), o mesmo valor que o
// TypeORM grava na tabela de controle ao aplicar.
//
// MIGRATION NOVA: acrescente a classe aqui, no fim. O teste ao lado
// (required-migrations.spec.ts) reprova uma migration do diretório que não
// esteja no manifesto, e também um nome que não exista no diretório.
import { InitialSchema1788782400000 } from '../migrations/1788782400000-InitialSchema.js';
import { AllowUndefinedPlanPrice1788782450000 } from '../migrations/1788782450000-AllowUndefinedPlanPrice.js';
import { InitialPlanCatalog1788782460000 } from '../migrations/1788782460000-InitialPlanCatalog.js';
import { NotificationJobs1792540800000 } from '../migrations/1792540800000-NotificationJobs.js';
import { PublicBooking1792627200000 } from '../migrations/1792627200000-PublicBooking.js';
import { WebPush1792713600000 } from '../migrations/1792713600000-WebPush.js';
import { AccountsAdministration1792800000000 } from '../migrations/1792800000000-AccountsAdministration.js';
import { TeamAccess1792886400000 } from '../migrations/1792886400000-TeamAccess.js';
import { StaffLogin1792972800000 } from '../migrations/1792972800000-StaffLogin.js';
import { AppointmentPayments1793059200000 } from '../migrations/1793059200000-AppointmentPayments.js';
import { TeamManagerAccess1793145600000 } from '../migrations/1793145600000-TeamManagerAccess.js';
import { CommercialAccess1793232000000 } from '../migrations/1793232000000-CommercialAccess.js';
import { PlatformPortal1793318400000 } from '../migrations/1793318400000-PlatformPortal.js';
import { AppointmentServiceSnapshots1793404800000 } from '../migrations/1793404800000-AppointmentServiceSnapshots.js';
import { ProfessionalCommissions1793491200000 } from '../migrations/1793491200000-ProfessionalCommissions.js';
import { ProfessionalCommissionSettings1793577600000 } from '../migrations/1793577600000-ProfessionalCommissionSettings.js';
import { TenantTestFlag1793664000000 } from '../migrations/1793664000000-TenantTestFlag.js';
import { AdminSecondFactor1793750400000 } from '../migrations/1793750400000-AdminSecondFactor.js';

const MIGRATION_CLASSES = [
  InitialSchema1788782400000,
  AllowUndefinedPlanPrice1788782450000,
  InitialPlanCatalog1788782460000,
  NotificationJobs1792540800000,
  PublicBooking1792627200000,
  WebPush1792713600000,
  AccountsAdministration1792800000000,
  TeamAccess1792886400000,
  StaffLogin1792972800000,
  AppointmentPayments1793059200000,
  TeamManagerAccess1793145600000,
  CommercialAccess1793232000000,
  PlatformPortal1793318400000,
  AppointmentServiceSnapshots1793404800000,
  ProfessionalCommissions1793491200000,
  ProfessionalCommissionSettings1793577600000,
  TenantTestFlag1793664000000,
  AdminSecondFactor1793750400000,
] as const;

/** Nomes exigidos, na ordem de aplicação. Mesma regra do TypeORM para o nome
 * gravado: `name` da instância ou, na falta, o nome da classe. */
export const REQUIRED_MIGRATIONS: readonly string[] = MIGRATION_CLASSES.map((Migration) => {
  const instancia: { name?: string } = new Migration();
  return instancia.name ?? Migration.name;
});
