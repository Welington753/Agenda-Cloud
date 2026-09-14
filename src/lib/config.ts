// Nome do produto centralizado para facilitar a troca de marca depois do protótipo.
export const NOME_PRODUTO = "Agenda Cloud";
export const SLOGAN_PRODUTO = "Agenda e gestão simples para pequenos negócios que trabalham com horário marcado.";

/** Endereço único do backend real (NestJS) — nenhum outro arquivo deve montar
 * essa URL na mão. Nunca aponta para Neon/produção por si só: em
 * desenvolvimento e nos testes é sempre um valor local/descartável definido
 * via `NEXT_PUBLIC_API_URL`; o padrão abaixo só cobre o `npm run dev` local. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Duração exibida do período de teste na demonstração. Só um rótulo de texto —
 * não aciona cobrança, assinatura ou qualquer bloqueio real de acesso. */
export const DIAS_TESTE_DEMONSTRACAO = 7;
