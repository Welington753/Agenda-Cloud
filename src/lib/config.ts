// Nome do produto exibido (TimVix). Identificadores técnicos antigos, como as
// chaves "agenda-cloud:*" do navegador e os nomes dos serviços no Render,
// continuam como estão de propósito (docs/plans/pagina-inicial-repaginada.md).
export const NOME_PRODUTO = "TimVix";
export const SLOGAN_PRODUTO = "Agenda e gestão simples para pequenos negócios que trabalham com horário marcado.";

/** Endereço único do backend real (NestJS) — nenhum outro arquivo deve montar
 * essa URL na mão. Nunca aponta para Neon/produção por si só: em
 * desenvolvimento e nos testes é sempre um valor local/descartável definido
 * via `NEXT_PUBLIC_API_URL`; o padrão abaixo só cobre o `npm run dev` local.
 * Pode ser uma origem (chamada direta) ou exatamente `/agenda_api` (mesma
 * origem, pelo proxy do Next.js; ver lib/api/proxy.ts e
 * lib/publicacao/api-url.ts). */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Duração exibida do período de teste na demonstração. Só um rótulo de texto —
 * não aciona cobrança, assinatura ou qualquer bloqueio real de acesso. */
export const DIAS_TESTE_DEMONSTRACAO = 7;
