// Rotas de "Equipe e acessos" (dono) e da agenda do funcionário. Todas
// exigem sessão; a identidade vem só do guard, e cada serviço prova no banco
// o vínculo com o estabelecimento da URL. Nenhuma rota aceita papel,
// profissional de outra pessoa ou estabelecimento no corpo. Respostas sem
// cache.
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { idSchema } from '../accounts/accounts.dto.js';
import { InvitesService } from '../accounts/invites.service.js';
import {
  ownAgendaPeriodSchema,
  type OwnAgendaPeriodDto,
} from '../appointments/appointment.dto.js';
import { MyAgendaService } from './my-agenda.service.js';
import { StaffAccountsService } from './staff-accounts.service.js';
import { TeamService } from './team.service.js';
import {
  myAgendaQuerySchema,
  ownStatusActionSchema,
  staffAccessChangeSchema,
  staffAccountSchema,
  staffInviteSchema,
  staffPasswordSchema,
  staffPermissionsChangeSchema,
  type MyAgendaQuery,
  type OwnStatusActionDto,
  type StaffAccessChangeDto,
  type StaffAccountDto,
  type StaffInviteDto,
  type StaffPasswordDto,
  type StaffPermissionsChangeDto,
} from './team.dto.js';
import type { StaffAction } from './staff-access.js';

type AuthenticatedRequest = Request & { [AUTH_CONTEXT_REQUEST_KEY]: IdentityContext };

const id = new ZodValidationPipe(idSchema);

@Controller('tenants/:tenantId/team')
@UseGuards(SessionGuard)
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly invites: InvitesService,
    private readonly staffAccounts: StaffAccountsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  overview(@Req() req: AuthenticatedRequest, @Param('tenantId', id) tenantId: string) {
    return this.team.overview(req.auth.userId, tenantId);
  }

  @Post('invites')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  invite(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(staffInviteSchema)) dto: StaffInviteDto,
  ) {
    return this.invites.inviteStaff(req.auth.userId, tenantId, dto);
  }

  /** Acesso com nome de usuário e a senha escolhida pelo dono (ou, no corpo
   * da tela anterior, senha temporária devolvida só nesta resposta). Exige
   * senha do dono confirmada há pouco. */
  @Post('staff-accounts')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  createStaffAccount(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(staffAccountSchema)) dto: StaffAccountDto,
  ) {
    return this.staffAccounts.create(req.auth.userId, req.auth.sessionId, tenantId, dto);
  }

  @Post('members/:membershipId/temporary-password')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  resetTemporaryPassword(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Param('membershipId', id) membershipId: string,
  ) {
    return this.staffAccounts.resetTemporaryPassword(req.auth.userId, req.auth.sessionId, tenantId, membershipId);
  }

  /** Senha escolhida pelo dono para o acesso interno: definitiva, encerra as
   * sessões da pessoa e nunca volta na resposta. Exige senha do dono
   * confirmada há pouco. */
  @Put('members/:membershipId/password')
  @Header('Cache-Control', 'private, no-store')
  setStaffPassword(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Param('membershipId', id) membershipId: string,
    @Body(new ZodValidationPipe(staffPasswordSchema)) dto: StaffPasswordDto,
  ) {
    return this.staffAccounts.setPassword(req.auth.userId, req.auth.sessionId, tenantId, membershipId, dto.password);
  }

  @Post('invites/:inviteId/resend')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  resend(@Req() req: AuthenticatedRequest, @Param('tenantId', id) tenantId: string, @Param('inviteId', id) inviteId: string) {
    return this.invites.resendStaff(req.auth.userId, tenantId, inviteId);
  }

  @Post('invites/:inviteId/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  revoke(@Req() req: AuthenticatedRequest, @Param('tenantId', id) tenantId: string, @Param('inviteId', id) inviteId: string) {
    return this.invites.revokeStaff(req.auth.userId, tenantId, inviteId);
  }

  @Post('members/:membershipId/suspend')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  suspend(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Param('membershipId', id) membershipId: string,
  ) {
    return this.team.suspend(req.auth.userId, req.auth.sessionId, tenantId, membershipId);
  }

  @Post('members/:membershipId/reactivate')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  reactivate(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Param('membershipId', id) membershipId: string,
  ) {
    return this.team.reactivate(req.auth.userId, req.auth.sessionId, tenantId, membershipId);
  }

  @Delete('members/:membershipId')
  @HttpCode(204)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Param('membershipId', id) membershipId: string,
  ) {
    await this.team.remove(req.auth.userId, req.auth.sessionId, tenantId, membershipId);
  }

  /** Perfil e profissional ligado de um acesso que já existe, com as
   * permissões que o dono conferiu na tela. Mesma conta, mesmo login, mesmo
   * vínculo; nenhum agendamento muda de profissional. */
  @Put('members/:membershipId/access')
  @Header('Cache-Control', 'private, no-store')
  changeAccess(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Param('membershipId', id) membershipId: string,
    @Body(new ZodValidationPipe(staffAccessChangeSchema)) dto: StaffAccessChangeDto,
  ) {
    return this.team.changeAccess(req.auth.userId, req.auth.sessionId, tenantId, membershipId, dto);
  }

  @Put('members/:membershipId/permissions')
  @Header('Cache-Control', 'private, no-store')
  permissions(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Param('membershipId', id) membershipId: string,
    @Body(new ZodValidationPipe(staffPermissionsChangeSchema)) dto: StaffPermissionsChangeDto,
  ) {
    return this.team.setPermissions(req.auth.userId, req.auth.sessionId, tenantId, membershipId, dto);
  }
}

@Controller('tenants/:tenantId/my-agenda')
@UseGuards(SessionGuard)
export class MyAgendaController {
  constructor(private readonly agenda: MyAgendaService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  day(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Query(new ZodValidationPipe(myAgendaQuerySchema)) query: MyAgendaQuery,
  ) {
    return this.agenda.day(req.auth.userId, tenantId, query);
  }

  @Get('range')
  @Header('Cache-Control', 'private, no-store')
  range(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Query(new ZodValidationPipe(ownAgendaPeriodSchema)) query: OwnAgendaPeriodDto,
  ) {
    return this.agenda.range(req.auth.userId, tenantId, query);
  }

  @Post(':appointmentId/start')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  start(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Param('appointmentId', id) appointmentId: string,
    @Body(new ZodValidationPipe(ownStatusActionSchema)) dto: OwnStatusActionDto,
  ) {
    return this.acao(req, tenantId, appointmentId, 'start', dto);
  }

  @Post(':appointmentId/complete')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  complete(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Param('appointmentId', id) appointmentId: string,
    @Body(new ZodValidationPipe(ownStatusActionSchema)) dto: OwnStatusActionDto,
  ) {
    return this.acao(req, tenantId, appointmentId, 'complete', dto);
  }

  @Post(':appointmentId/no-show')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  noShow(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Param('appointmentId', id) appointmentId: string,
    @Body(new ZodValidationPipe(ownStatusActionSchema)) dto: OwnStatusActionDto,
  ) {
    return this.acao(req, tenantId, appointmentId, 'no-show', dto);
  }

  private async acao(
    req: AuthenticatedRequest,
    tenantId: string,
    appointmentId: string,
    acao: StaffAction,
    dto: OwnStatusActionDto,
  ) {
    const appointment = await this.agenda.changeOwnStatus(req.auth.userId, tenantId, appointmentId, acao, dto);
    return { appointment };
  }
}
