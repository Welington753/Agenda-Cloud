// Dados estruturados (JSON-LD, schema.org) e a serialização segura usada em
// todas as páginas que os publicam.
//
// Só entra o que a página mostra de verdade: nada de avaliação, endereço,
// horário de funcionamento ou preço que não esteja na tela.
import { NOME_PRODUTO, SLOGAN_PRODUTO } from "@/lib/config";

/** JSON para um `<script type="application/ld+json">`. `JSON.stringify` não
 * escapa `<`, então um nome com `</script>` fecharia o elemento e o resto
 * viraria HTML. Escapar `<`, `>` e `&` como sequências de escape mantém o JSON
 * equivalente; U+2028/U+2029 também, por segurança de scripts antigos. */
const SEPARADOR_DE_LINHA = String.fromCharCode(0x2028);
const SEPARADOR_DE_PARAGRAFO = String.fromCharCode(0x2029);

export function serializarJsonLd(dados: unknown): string {
  return JSON.stringify(dados)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replaceAll(SEPARADOR_DE_LINHA, "\\u2028")
    .replaceAll(SEPARADOR_DE_PARAGRAFO, "\\u2029");
}

/** Página inicial: a organização que oferece o produto, com o ícone do
 * aplicativo como logotipo. `origem` é a origem confiável do site. */
export function jsonLdDaPlataforma(origem: string): Record<string, unknown> {
  const url = new URL("/", origem).toString();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: NOME_PRODUTO,
    url,
    logo: new URL("/icone-512.png", origem).toString(),
    description: SLOGAN_PRODUTO,
  };
}
