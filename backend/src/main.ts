import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { buildCorsOptions } from './config/cors.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Necessário para o futuro cookie de sessão (Lote 6B.3+, ver
  // config/session-cookie.config.ts) — nenhum endpoint emite cookie ainda
  // neste lote, mas o parser precisa estar registrado antes deles existirem.
  app.use(cookieParser());

  // Origem exata de FRONTEND_URL (nunca wildcard) + credentials:true — ver
  // config/cors.config.ts para a justificativa de nunca combinar as duas
  // coisas com "*".
  app.enableCors(buildCorsOptions(configService.getOrThrow<string>('FRONTEND_URL')));

  // `trust proxy` fica desligado por padrão — depende de como a aplicação for
  // hospedada de fato (proxy reverso, load balancer). Nunca habilitar de
  // forma genérica: um `trust proxy` incorreto permite forjar IP/protocolo via
  // header e quebra rate limit por IP. Configuração explícita fica para
  // quando a hospedagem real for definida (fora deste lote).

  // Porta validada pelo AppConfigModule (env.validation.ts) — nunca lida
  // diretamente de `process.env`, padrão 3001 se a env não a definir.
  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);
}
await bootstrap();
