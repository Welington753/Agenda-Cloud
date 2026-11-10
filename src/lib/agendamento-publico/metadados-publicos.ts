// Título, descrição e dados estruturados da página pública de agendamento
// (`/agendar/<slug>`), a partir da MESMA leitura pública que a tela mostra
// (nome do estabelecimento e serviços oferecidos). Nada além disso: o
// contrato público não traz endereço, telefone, horário de funcionamento nem
// avaliações, e nada disso é inventado aqui.
import type { PaginaPublica } from "@/lib/api/public-booking-api";
import { NOME_PRODUTO } from "@/lib/config";

/** Endereço canônico da página do estabelecimento (caminho). */
export function caminhoDaPaginaPublica(slug: string): string {
  return `/agendar/${encodeURIComponent(slug)}`;
}

/** A página entra na busca? Só um estabelecimento de teste diz que não
 * (`indexable: false`); campo ausente (API anterior) é indexável, como antes.
 * A mesma regra vale para os metadados (layout) e para o cabeçalho
 * `X-Robots-Tag` (src/proxy.ts). */
export function paginaIndexavel(pagina: PaginaPublica): boolean {
  return pagina.indexable !== false;
}

const LIMITE_DESCRICAO = 160;

function encurtar(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const corte = texto.slice(0, limite - 1);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > limite / 2 ? corte.slice(0, espaco) : corte).replace(/[\s,.;:]+$/, "")}…`;
}

export function tituloDaPaginaPublica(nome: string): string {
  return `${nome} · Agendamento online`;
}

/** Descrição própria de cada estabelecimento: o nome e os primeiros serviços
 * da página, na ordem em que a tela os mostra. */
export function descricaoDaPaginaPublica(pagina: PaginaPublica): string {
  const nome = pagina.establishment.name;
  const servicos = pagina.services.map((s) => s.name.trim()).filter(Boolean);
  const base = `Peça seu horário em ${nome} pela internet: escolha o serviço, o profissional e o horário.`;
  if (servicos.length === 0) return encurtar(base, LIMITE_DESCRICAO);
  const lista = servicos.slice(0, 4).join(", ");
  return encurtar(`${base} Serviços: ${lista}${servicos.length > 4 ? " e outros" : ""}.`, LIMITE_DESCRICAO);
}

/** Metadados de quando a página não pôde ser lida no servidor (API acordando
 * ou sem configuração): genéricos, sem afirmar nada sobre o estabelecimento. */
export const TITULO_PAGINA_PUBLICA_GENERICO = `Agendamento online · ${NOME_PRODUTO}`;
export const DESCRICAO_PAGINA_PUBLICA_GENERICA =
  "Escolha o serviço, o profissional e o horário para pedir seu agendamento.";

/** JSON-LD do estabelecimento. `Organization` (e não `LocalBusiness`): a
 * página não mostra endereço, e nem todo negócio atende num local físico.
 * Preço só quando a tela o mostra como valor (visível e não "sob consulta"). */
export function jsonLdDaPaginaPublica(pagina: PaginaPublica, urlCanonica: string): Record<string, unknown> {
  const ofertas = pagina.services.map((s) => {
    const servico: Record<string, unknown> = { "@type": "Service", name: s.name };
    if (s.description.trim()) servico.description = s.description.trim();
    const oferta: Record<string, unknown> = { "@type": "Offer", itemOffered: servico };
    if (s.priceVisible && s.priceCents !== null) {
      oferta.price = (s.priceCents / 100).toFixed(2);
      oferta.priceCurrency = "BRL";
    }
    return oferta;
  });
  const dados: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: pagina.establishment.name,
    url: urlCanonica,
  };
  if (ofertas.length > 0) dados.makesOffer = ofertas;
  return dados;
}
