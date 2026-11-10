// 404 do endereço curto `/<slug>`: a API confirmou que não há estabelecimento
// real com esse slug. O HTML do servidor é a página 404 de todo o site
// (status 404, `noindex` automático). Só no navegador que criou um
// estabelecimento com esse slug na demonstração (localStorage, legado) a
// vitrine da demonstração aparece no lugar.
import type { Metadata } from "next";
import { ConteudoNaoEncontrada } from "@/components/site/conteudo-nao-encontrada";
import { METADADOS_NAO_ENCONTRADA } from "@/lib/site/metadados-do-site";
import { DemonstracaoOuNaoEncontrada } from "./demonstracao";

export const metadata: Metadata = METADADOS_NAO_ENCONTRADA;

export default function EnderecoCurtoNaoEncontrado() {
  return (
    <DemonstracaoOuNaoEncontrada>
      <ConteudoNaoEncontrada />
    </DemonstracaoOuNaoEncontrada>
  );
}
