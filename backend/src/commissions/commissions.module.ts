import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommissionsController } from './commissions.controller.js';
import { CommissionsService } from './commissions.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CommissionsController],
  providers: [CommissionsService],
})
export class CommissionsModule {}
