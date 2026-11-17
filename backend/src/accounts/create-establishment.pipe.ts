// Validação da criação de estabelecimento com a assinatura modular.
//
// Intervalo de publicação (API nova, web anterior): o web anterior manda
// `planId` e não manda `teamUserLimit`. Esse corpo vira o marcador
// `OUTDATED_CREATE_BODY`; o serviço confere a permissão primeiro (quem não
// pode criar recebe 403, como sempre) e só então recusa com
// `TELA_DESATUALIZADA` em 409 (o web anterior só exibe a mensagem do servidor
// em 409; em 400 mostra um texto genérico). Nunca cria estabelecimento sem
// limite nem cai no plano anterior em silêncio.
import { type PipeTransform } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  createEstablishmentSchema,
  LEGACY_CREATE_ESTABLISHMENT_FIELDS,
  type CreateEstablishmentDto,
} from './accounts.dto.js';

export const OUTDATED_SCREEN_CODE = 'TELA_DESATUALIZADA';
export const OUTDATED_SCREEN_MESSAGE =
  'Esta tela está desatualizada. Recarregue a página para criar o estabelecimento com a assinatura modular e o limite de usuários.';

export const OUTDATED_CREATE_BODY = { outdated: true } as const;
export type OutdatedCreateBody = typeof OUTDATED_CREATE_BODY;

export const isOutdatedCreateBody = (v: CreateEstablishmentDto | OutdatedCreateBody): v is OutdatedCreateBody =>
  'outdated' in v && v.outdated === true;

export class CreateEstablishmentPipe implements PipeTransform<unknown, CreateEstablishmentDto | OutdatedCreateBody> {
  private readonly zod = new ZodValidationPipe(createEstablishmentSchema);

  transform(value: unknown): CreateEstablishmentDto | OutdatedCreateBody {
    if (
      value !== null &&
      typeof value === 'object' &&
      LEGACY_CREATE_ESTABLISHMENT_FIELDS.some((campo) => campo in value)
    ) {
      return OUTDATED_CREATE_BODY;
    }
    return this.zod.transform(value);
  }
}
