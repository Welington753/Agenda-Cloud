// Notificações Web Push de novas solicitações. Exporta o executor para o
// PublicBookingModule acioná-lo depois do commit de um pedido (uma única
// instância por processo: o controle "um lote por vez" vive nela).
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { DisparadorDePush } from './push-dispatcher.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [PushController],
  providers: [DisparadorDePush, PushService, TrustedOriginGuard],
  exports: [DisparadorDePush],
})
export class PushModule {}
