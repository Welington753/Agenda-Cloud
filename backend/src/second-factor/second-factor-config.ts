// Configuração do segundo fator das contas de plataforma, lida do ambiente da
// API (validada em config/env.validation.ts). Nunca vem do banco nem do web.
//
// - `PLATFORM_2FA_ENFORCEMENT`:
//   - `optional`: conta de plataforma SEM fator usa o portal como antes; conta
//     COM fator ativo precisa dele; master novo (convite ou promoção) precisa
//     cadastrar antes de usar o portal;
//   - `required`: nenhuma conta de plataforma usa o portal sem fator.
//   Em production a variável é obrigatória (sem padrão). Fora dela, `optional`.
//   Não existe valor que desligue o segundo fator.
// - `PLATFORM_TOTP_KEYS`: `versão:base64` separados por vírgula, cada chave com
//   exatamente 32 bytes (AES-256-GCM). `PLATFORM_TOTP_KEY_CURRENT`: a versão
//   usada para cifrar. As antigas continuam na lista até nenhum segredo
//   depender delas (rotação, ver o runbook do lote).
//
// Sem chaves válidas, nenhum segredo é cifrado nem decifrado: cadastrar e
// verificar pelo aplicativo respondem "indisponível". Isso NUNCA libera o
// portal: uma conta com fator continua exigindo o segundo fator.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  parseTotpKeyring,
  type SecondFactorEnforcement,
  type TotpKeyring,
} from './second-factor-keys.js';

export {
  parseTotpKeyring,
  SECOND_FACTOR_ENFORCEMENTS,
  TOTP_KEY_BYTES,
  type SecondFactorEnforcement,
  type TotpKeyring,
} from './second-factor-keys.js';

@Injectable()
export class SecondFactorConfig {
  readonly enforcement: SecondFactorEnforcement;
  /** `null`: sem chaves válidas (cadastro e verificação pelo app indisponíveis). */
  readonly keyring: TotpKeyring | null;

  constructor(config: ConfigService) {
    const enforcement = config.get<string>('PLATFORM_2FA_ENFORCEMENT');
    // Valor inválido não passa da validação do ambiente; se chegar aqui por
    // outro caminho, vale a opção mais rígida.
    this.enforcement = enforcement === 'optional' || enforcement === undefined ? 'optional' : 'required';
    const ring = parseTotpKeyring(config.get<string>('PLATFORM_TOTP_KEYS'), config.get<string>('PLATFORM_TOTP_KEY_CURRENT'));
    this.keyring = ring === 'INVALID' ? null : ring;
  }
}
