// Página 404 de todo o site: endereço inexistente e estabelecimento que não
// existe ou desligou a página pública (`notFound()` em
// src/app/agendar/[slug]/layout.tsx; o endereço curto `/<slug>` tem o seu,
// src/app/[slug]/not-found.tsx, com o mesmo conteúdo). Responde com status
// 404 e o Next.js acrescenta `noindex` sozinho.
import type { Metadata } from "next";
import { ConteudoNaoEncontrada } from "@/components/site/conteudo-nao-encontrada";
import { METADADOS_NAO_ENCONTRADA } from "@/lib/site/metadados-do-site";

export const metadata: Metadata = METADADOS_NAO_ENCONTRADA;

export default function NaoEncontrada() {
  return <ConteudoNaoEncontrada />;
}
