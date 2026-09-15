import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ServicesModule } from './services/services.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [AppConfigModule, DatabaseModule, AuthModule, ServicesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
