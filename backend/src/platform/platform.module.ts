import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';
import { EstablishmentAdminService } from './establishment-admin.service.js';
import { AccessValidityService } from './access-validity.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [PlatformService, EstablishmentAdminService, AccessValidityService],
})
export class PlatformModule {}
