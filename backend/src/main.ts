import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Porta validada pelo AppConfigModule (env.validation.ts) — nunca lida
  // diretamente de `process.env`, padrão 3001 se a env não a definir.
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);
}
await bootstrap();
