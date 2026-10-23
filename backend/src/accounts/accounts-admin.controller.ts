// Rotas da gestão de contas na administração da plataforma. Todas exigem
// sessão (SessionGuard) e a identidade vem SÓ do guard; cada serviço relê
// papel e permissões no banco. Respostas sem cache.
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  auditQuerySchema,
  createEstablishmentSchema,
  deniedPermissionsSchema,
  idSchema,
  inviteMemberSchema,
  invitesQuerySchema,
  platformAccessSchema,
  platformInviteSchema,
  reauthSchema,
  requestKeySchema,
  requestOnlySchema,
  statusChangeSchema,
  updateUserSchema,
  usersQuerySchema,
  type AuditQuery,
  type CreateEstablishmentDto,
  type DeniedPermissionsDto,
  type InviteMemberDto,
  type InvitesQuery,
  type PlatformAccessDto,
  type PlatformInviteDto,
  type StatusChangeDto,
  type UpdateUserDto,
  type UsersQuery,
} from './accounts.dto.js';
import { AccountsAdminService } from './accounts-admin.service.js';
import { AccountsDirectoryService } from './accounts-directory.service.js';
import { InvitesService } from './invites.service.js';
import { PasswordResetsService } from './password-resets.service.js';

type AuthenticatedRequest = Request & { [AUTH_CONTEXT_REQUEST_KEY]: IdentityContext };

const id = new ZodValidationPipe(idSchema);

@Controller('platform')
@UseGuards(SessionGuard)
export class AccountsAdminController {
  constructor(
    private readonly directory: AccountsDirectoryService,
    private readonly admin: AccountsAdminService,
    private readonly invites: InvitesService,
    private readonly resets: PasswordResetsService,
  ) {}

  @Get('roles')
  @Header('Cache-Control', 'private, no-store')
  roles(@Req() req: AuthenticatedRequest) {
    return this.directory.roles(req.auth.userId);
  }

  @Get('plans')
  @Header('Cache-Control', 'private, no-store')
  plans(@Req() req: AuthenticatedRequest) {
    return this.directory.plans(req.auth.userId);
  }

  @Get('establishment-options')
  @Header('Cache-Control', 'private, no-store')
  establishmentOptions(@Req() req: AuthenticatedRequest) {
    return this.directory.establishmentOptions(req.auth.userId);
  }

  @Post('establishments')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  createEstablishment(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createEstablishmentSchema)) dto: CreateEstablishmentDto,
  ) {
    return this.invites.createEstablishment(req.auth.userId, dto);
  }

  @Get('establishments/:tenantId/members')
  @Header('Cache-Control', 'private, no-store')
  members(@Req() req: AuthenticatedRequest, @Param('tenantId', id) tenantId: string) {
    return this.directory.establishmentMembers(req.auth.userId, tenantId);
  }

  @Post('establishments/:tenantId/invites')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  inviteMember(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(inviteMemberSchema)) dto: InviteMemberDto,
  ) {
    return this.invites.inviteMember(req.auth.userId, tenantId, dto);
  }

  @Get('users')
  @Header('Cache-Control', 'private, no-store')
  users(@Req() req: AuthenticatedRequest, @Query(new ZodValidationPipe(usersQuerySchema)) query: UsersQuery) {
    return this.directory.listUsers(req.auth.userId, query);
  }

  @Get('users/:userId')
  @Header('Cache-Control', 'private, no-store')
  user(@Req() req: AuthenticatedRequest, @Param('userId', id) userId: string) {
    return this.directory.userDetail(req.auth.userId, userId);
  }

  @Patch('users/:userId')
  @Header('Cache-Control', 'private, no-store')
  updateUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId', id) userId: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.admin.updateUser(req.auth.userId, userId, dto);
  }

  @Post('users/:userId/block')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  block(
    @Req() req: AuthenticatedRequest,
    @Param('userId', id) userId: string,
    @Body(new ZodValidationPipe(statusChangeSchema)) dto: StatusChangeDto,
  ) {
    return this.admin.block(req.auth.userId, req.auth.sessionId, userId, dto);
  }

  @Post('users/:userId/reactivate')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  reactivate(
    @Req() req: AuthenticatedRequest,
    @Param('userId', id) userId: string,
    @Body(new ZodValidationPipe(statusChangeSchema)) dto: StatusChangeDto,
  ) {
    return this.admin.reactivate(req.auth.userId, req.auth.sessionId, userId, dto);
  }

  @Put('users/:userId/platform-access')
  @Header('Cache-Control', 'private, no-store')
  platformAccess(
    @Req() req: AuthenticatedRequest,
    @Param('userId', id) userId: string,
    @Body(new ZodValidationPipe(platformAccessSchema)) dto: PlatformAccessDto,
  ) {
    return this.admin.setPlatformAccess(req.auth.userId, req.auth.sessionId, userId, dto);
  }

  @Post('users/:userId/password-reset')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  passwordReset(
    @Req() req: AuthenticatedRequest,
    @Param('userId', id) userId: string,
    @Body(new ZodValidationPipe(requestOnlySchema)) dto: { requestKey: string },
  ) {
    return this.resets.request(req.auth.userId, userId, dto.requestKey);
  }

  @Delete('memberships/:membershipId')
  @HttpCode(204)
  async removeMembership(@Req() req: AuthenticatedRequest, @Param('membershipId', id) membershipId: string) {
    await this.admin.removeMembership(req.auth.userId, req.auth.sessionId, membershipId);
  }

  @Put('memberships/:membershipId/denied-permissions')
  @Header('Cache-Control', 'private, no-store')
  deniedPermissions(
    @Req() req: AuthenticatedRequest,
    @Param('membershipId', id) membershipId: string,
    @Body(new ZodValidationPipe(deniedPermissionsSchema)) dto: DeniedPermissionsDto,
  ) {
    return this.admin.setDeniedPermissions(req.auth.userId, req.auth.sessionId, membershipId, dto);
  }

  @Get('invites')
  @Header('Cache-Control', 'private, no-store')
  listInvites(@Req() req: AuthenticatedRequest, @Query(new ZodValidationPipe(invitesQuerySchema)) query: InvitesQuery) {
    return this.directory.listInvites(req.auth.userId, query);
  }

  @Post('invites')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  invitePlatform(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(platformInviteSchema)) dto: PlatformInviteDto,
  ) {
    return this.invites.invitePlatform(req.auth.userId, dto);
  }

  @Post('invites/:inviteId/resend')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  resend(@Req() req: AuthenticatedRequest, @Param('inviteId', id) inviteId: string) {
    return this.invites.resend(req.auth.userId, inviteId);
  }

  @Post('invites/:inviteId/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  revoke(@Req() req: AuthenticatedRequest, @Param('inviteId', id) inviteId: string) {
    return this.invites.revoke(req.auth.userId, inviteId);
  }

  /** Resultado de um formulário cuja resposta se perdeu: a tela consulta
   * antes de oferecer outra tentativa. Só devolve o que ESTA conta criou. */
  @Get('requests/:requestKey')
  @Header('Cache-Control', 'private, no-store')
  async request(
    @Req() req: AuthenticatedRequest,
    @Param('requestKey', new ZodValidationPipe(requestKeySchema)) requestKey: string,
  ) {
    const invite = await this.invites.findByRequestKey(req.auth.userId, requestKey);
    if (invite) return { kind: 'invite', ...invite };
    const reset = await this.resets.findByRequestKey(req.auth.userId, requestKey);
    if (reset) return { kind: 'password-reset', created: false, reset, delivery: null };
    throw new NotFoundException('Nada foi criado com este formulário.');
  }

  @Get('audit')
  @Header('Cache-Control', 'private, no-store')
  audit(@Req() req: AuthenticatedRequest, @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery) {
    return this.directory.listAudit(req.auth.userId, query);
  }

  @Post('reauth')
  @HttpCode(204)
  async reauth(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(reauthSchema)) dto: { password: string }) {
    await this.admin.reauthenticate(req.auth.userId, req.auth.sessionId, dto.password);
  }
}
