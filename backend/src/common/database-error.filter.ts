// Erro de banco que chega à borda HTTP sem tratamento: resposta 500 genérica,
// igual à do Nest, e log SEM os valores da query.
//
// O tratador padrão do Nest faz `logger.error(erro)`, e o ConsoleLogger
// imprime o objeto inteiro: o `QueryFailedError` do TypeORM leva `parameters`
// (hash de senha, hash de token de sessão) e `driverError` (com o `detail` do
// PostgreSQL, que repete a linha). Aqui o log usa o mesmo resumo do logger do
// TypeORM (database/safe-typeorm-logger.ts) e a pilha sem a primeira linha,
// que repete a mensagem.
import { Catch, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { pilhaSemMensagem, resumoDaFalha } from '../database/safe-typeorm-logger.js';

@Catch(QueryFailedError)
export class DatabaseErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(erro: QueryFailedError, host: ArgumentsHost): void {
    this.logger.error(resumoDaFalha(erro), pilhaSemMensagem(erro));
    if (host.getType() !== 'http') return;
    const { httpAdapter } = this.adapterHost;
    const resposta = host.switchToHttp().getResponse<unknown>();
    const corpo = { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
    if (httpAdapter.isHeadersSent(resposta)) httpAdapter.end(resposta);
    else httpAdapter.reply(resposta, corpo, corpo.statusCode);
  }
}
