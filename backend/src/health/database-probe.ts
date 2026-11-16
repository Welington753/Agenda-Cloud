// Sonda leve do banco para o health check (`GET /health`): um `SELECT 1`.
//
// NÃO é a conferência de migrations: aquela roda uma vez, na inicialização
// (database/schema-readiness.ts), e impede o processo de subir. Esta responde
// só "o banco atende agora?", a cada chamada do health check, e nunca lê a
// tabela de controle.
//
// PRAZOS, pensados para o health check do Render (render.com/docs/health-checks,
// lido em 13/11/2026): cada chamada precisa de 2xx/3xx em até 5 s; 15 s de
// falhas seguidas tiram a instância do tráfego; 60 s reiniciam a instância.
// - A sonda desiste em 3 s, abaixo dos 5 s: quem responde 503 é a API, em vez
//   de o Render estourar o próprio prazo.
// - Uma falha isolada (banco acordando, oscilação de rede) não derruba nada:
//   são os 15 s seguidos do Render que decidem. Aqui não há contagem própria.
//
// LIMITES DE CARGA (a rota é pública e sem sessão):
// - sucesso reaproveitado por 5 s: várias chamadas viram uma consulta;
// - uma sonda por vez: chamadas simultâneas esperam a mesma;
// - consulta que passou do prazo e ainda não voltou: nenhuma outra é aberta
//   até ela terminar (o banco parado não acumula consultas penduradas), e a
//   resposta é "indisponível" na hora.
import { Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Prazo da sonda. Menor que os 5 s do health check do Render. */
export const PROBE_TIMEOUT_MS = 3_000;
/** Por quanto tempo um sucesso vale sem nova consulta. */
export const PROBE_SUCCESS_TTL_MS = 5_000;

@Injectable()
export class DatabaseProbe {
  private readonly logger = new Logger('DatabaseProbe');
  private ultimoSucesso: number | null = null;
  private emAndamento: Promise<boolean> | null = null;
  /** Consulta que estourou o prazo e ainda não terminou. */
  private pendurada = false;

  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    private readonly agora: () => number = () => Date.now(),
  ) {}

  /** `true`: o banco respondeu dentro do prazo (agora ou há menos de 5 s). */
  async isAvailable(): Promise<boolean> {
    if (this.ultimoSucesso !== null && this.agora() - this.ultimoSucesso < PROBE_SUCCESS_TTL_MS) return true;
    if (this.pendurada) return false;
    this.emAndamento ??= this.sondar().finally(() => {
      this.emAndamento = null;
    });
    return this.emAndamento;
  }

  private async sondar(): Promise<boolean> {
    let relogio: NodeJS.Timeout | undefined;
    const consulta = Promise.resolve()
      .then(() => this.dataSource.query('SELECT 1'))
      .then(
        () => true,
        (erro: unknown) => {
          // Só o código do driver: a mensagem pode repetir host e usuário.
          this.logger.warn(`Banco indisponível na sonda do health check (${codigoDe(erro)}).`);
          return false;
        },
      );
    const prazo = new Promise<'prazo'>((resolve) => {
      relogio = setTimeout(() => resolve('prazo'), PROBE_TIMEOUT_MS);
    });
    const resultado = await Promise.race([consulta, prazo]);
    clearTimeout(relogio);

    if (resultado === 'prazo') {
      this.pendurada = true;
      void consulta.finally(() => {
        this.pendurada = false;
      });
      this.ultimoSucesso = null;
      this.logger.warn(`Banco não respondeu à sonda do health check em ${PROBE_TIMEOUT_MS} ms.`);
      return false;
    }
    this.ultimoSucesso = resultado ? this.agora() : null;
    return resultado;
  }
}

function codigoDe(erro: unknown): string {
  for (const candidato of [erro, (erro as { driverError?: unknown } | null)?.driverError]) {
    const codigo = (candidato as { code?: unknown } | null | undefined)?.code;
    if (typeof codigo === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(codigo)) return `código ${codigo}`;
  }
  return 'sem código do driver';
}
