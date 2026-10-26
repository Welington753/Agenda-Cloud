// "Equipe e acessos" (dono) e agenda do funcionário. Reusa o convite da
// gestão de contas (InvitesService) e o andamento dos atendimentos
// (AppointmentsService): nenhuma segunda cópia das regras de aceite, de
// horário ou de estado.
import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MyAgendaController, TeamController } from './team.controller.js';
import { MyAgendaService } from './my-agenda.service.js';
import { TeamService } from './team.service.js';

@Module({
  imports: [AuthModule, AccountsModule, AppointmentsModule],
  controllers: [TeamController, MyAgendaController],
  providers: [TeamService, MyAgendaService],
})
export class TeamModule {}
