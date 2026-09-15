// Módulo de gestão de serviços (Lote 6D.1). Sem rate limit próprio: são
// rotas autenticadas por sessão (tentar em massa já exige uma sessão válida),
// diferente de /auth/register e /auth/login, que são anônimas.
//
// `SessionGuard` vem importado do AuthModule, nunca redeclarado aqui — uma
// segunda declaração criaria uma segunda instância da mesma regra de
// autenticação, com risco real de as duas divergirem numa mudança futura.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
