import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';
import { EstablishmentAdminService } from './establishment-admin.service.js';
import { AccessValidityService } from './access-validity.service.js';
import { AccessCorrectionService } from './access-correction.service.js';
import { NoExpiryService } from './no-expiry.service.js';
import { PricingService } from './pricing.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [
    PlatformService,
    EstablishmentAdminService,
    AccessValidityService,
    AccessCorrectionService,
    NoExpiryService,
    PricingService,
  ],
})
export class PlatformModule {}
