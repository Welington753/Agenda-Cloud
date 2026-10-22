// Gera UM par de chaves VAPID (P-256) para o Web Push, só com `node:crypto`.
//
// Uso: `npm run push:generate-vapid-keys` (na pasta backend). Imprime as
// três linhas para colar nas variáveis de ambiente da API — NUNCA no
// frontend, no repositório ou em log compartilhado. Gere uma vez e guarde:
// trocar o par depois invalida todas as inscrições (cada aparelho precisa
// ativar de novo).
import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
process.stdout.write(
  [
    `WEB_PUSH_VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`,
    `WEB_PUSH_VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString('base64url')}`,
    'WEB_PUSH_SUBJECT=mailto:troque-pelo-seu-email@exemplo.com',
    '',
  ].join('\n'),
);
