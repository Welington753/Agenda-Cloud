// `GET /health`: disponibilidade da API COM o banco, para o health check da
// hospedagem. Pública, sem sessão, sem dado nenhum além do estado.
//
// - 200 `{ "status": "ok" }`: o processo atende e o banco respondeu.
// - 503 `{ "status": "unavailable" }`: o banco não respondeu no prazo (ver
//   database-probe.ts). O corpo nunca traz o motivo, host, erro ou versão.
//
// `GET /` (app.controller.ts) continua igual: responde sem tocar no banco e é
// o caminho que o `render.yaml` usa hoje. Trocar o `healthCheckPath` para
// `/health` é um passo de publicação à parte, só depois de uma API com esta
// rota estar no ar (docs/plans/publicacao-segura.md).
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseProbe } from './database-probe.js';

@Controller('health')
export class HealthController {
  constructor(private readonly probe: DatabaseProbe) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ok' | 'unavailable' }> {
    // Estado do instante: nenhum intermediário deve guardar a resposta.
    res.setHeader('Cache-Control', 'no-store');
    if (await this.probe.isAvailable()) return { status: 'ok' };
    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: 'unavailable' };
  }
}
