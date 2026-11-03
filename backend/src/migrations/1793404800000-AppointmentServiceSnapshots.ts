// Agendamento com vários serviços (ver
// docs/plans/agendamento-multiplos-servicos.md). Só ACRESCENTA uma coluna
// anulável em `appointment_items`, que já guarda um item por serviço desde a
// migration inicial (preço, duração e posição congelados).
//
// `service_name_snapshot`: o nome do serviço no momento da reserva, para que
// renomear ou desativar o serviço depois não reescreva o histórico. Os itens
// que já existem ficam com NULL: o nome daquela época não foi gravado e não é
// inventado (a tela continua mostrando o nome atual para eles, como antes).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AppointmentServiceSnapshots1793404800000 implements MigrationInterface {
  name = 'AppointmentServiceSnapshots1793404800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE appointment_items ADD COLUMN service_name_snapshot varchar NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE appointment_items DROP COLUMN service_name_snapshot`);
  }
}
