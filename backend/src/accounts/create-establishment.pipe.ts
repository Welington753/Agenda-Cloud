// Validação da criação de estabelecimento com a assinatura modular.
//
// Intervalo de publicação (API nova, web anterior): o web anterior manda
// `planId` e não manda `teamUserLimit`. Esse corpo é recusado com o código
// `TELA_DESATUALIZADA` em 409 (o web anterior só exibe a mensagem do servidor
// em 409; em 400 mostra um texto genérico); nunca
// cria estabelecimento sem limite nem cai no plano anterior em silêncio.
import { ConflictException, type PipeTransform } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  createEstablishmentSchema,
  LEGACY_CREATE_ESTABLISHMENT_FIELDS,
  type CreateEstablishmentDto,
} from './accounts.dto.js';

export const OUTDATED_SCREEN_CODE = 'TELA_DESATUALIZADA';
export const OUTDATED_SCREEN_MESSAGE =
  'Esta tela está desatualizada. Recarregue a página para criar o estabelecimento com a assinatura modular e o limite de usuários.';

export class CreateEstablishmentPipe implements PipeTransform<unknown, CreateEstablishmentDto> {
  private readonly zod = new ZodValidationPipe(createEstablishmentSchema);

  transform(value: unknown): CreateEstablishmentDto {
    if (
      value !== null &&
      typeof value === 'object' &&
      LEGACY_CREATE_ESTABLISHMENT_FIELDS.some((campo) => campo in value)
    ) {
      throw new ConflictException({ code: OUTDATED_SCREEN_CODE, message: OUTDATED_SCREEN_MESSAGE });
    }
    return this.zod.transform(value);
  }
}
