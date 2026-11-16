import cookieParser from 'cookie-parser';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module.js';
import { buildCorsOptions } from './config/cors.config.js';
import { SchemaNotReadyError, ensureRequiredMigrations } from './database/schema-readiness.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Antes de qualquer gancho de módulo e de escutar a porta: o banco precisa
  // ter todas as migrations que este código exige (database/schema-readiness.ts).
  // Só leitura; a API nunca aplica migration. Faltando alguma, o processo
  // termina com o diagnóstico e código de saída 1, sem aceitar tráfego: no
  // Render, o deploy novo não fica saudável e o anterior continua no ar.
  try {
    await ensureRequiredMigrations(app.get(DataSource), new Logger('SchemaReadiness'));
  } catch (erro) {
    if (!(erro instanceof SchemaNotReadyError)) throw erro;
    new Logger('SchemaReadiness').error(erro.message);
    await app.close().catch(() => undefined);
    process.exit(1);
  }

  // Necessário para o futuro cookie de sessão (Lote 6B.3+, ver
  // config/session-cookie.config.ts) — nenhum endpoint emite cookie ainda
  // neste lote, mas o parser precisa estar registrado antes deles existirem.
  app.use(cookieParser());

  // Origem exata de FRONTEND_URL (nunca wildcard) + credentials:true — ver
  // config/cors.config.ts para a justificativa de nunca combinar as duas
  // coisas com "*".
  app.enableCors(buildCorsOptions(configService.getOrThrow<string>('FRONTEND_URL')));

  // `trust proxy` continua DESLIGADO, também na hospedagem: no Render a borda
  // acrescenta ao `X-Forwarded-For` enviado pelo cliente e o número de saltos
  // até a aplicação não é documentado, então nem `true` nem uma contagem de
  // saltos são seguros. O IP usado no rate limit vem de uma fonte explícita:
  // `CLIENT_IP_SOURCE` e, para o tráfego do proxy do frontend
  // (`/agenda_api`), `X-Agenda-Client-IP` aceito só com `API_PROXY_SECRET`
  // (ver config/client-ip.ts e docs/runbooks/publicacao-piloto-render.md).
  // Nenhum código depende de
  // `req.protocol`/`req.secure`: o cookie `Secure` vem de NODE_ENV (ver
  // config/session-cookie.config.ts).

  // Porta validada pelo AppConfigModule (env.validation.ts) — nunca lida
  // diretamente de `process.env`, padrão 3001 se a env não a definir. No
  // Render, `PORT` vem da plataforma e `HOST` é `0.0.0.0` (ver render.yaml).
  const port = configService.getOrThrow<number>('PORT');
  const host = configService.get<string>('HOST');
  if (host === undefined) {
    await app.listen(port);
  } else {
    await app.listen(port, host);
  }
}
await bootstrap();
