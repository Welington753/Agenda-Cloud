import type { NextConfig } from "next";
import { erroDeApiUrlDePublicacao } from "./src/lib/publicacao/api-url";
import { ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA } from "./src/lib/administracao/rotas";
import { ENCAMINHAMENTOS_CONTA_ANTIGA } from "./src/lib/conta/rotas";
import { API_BASE_URL } from "./src/lib/config";
import { regrasDeCabecalhos } from "./src/lib/site/cabecalhos";
import { lerConfiguracaoDoSite } from "./src/lib/site/origem-do-site";

// No build da hospedagem, `NEXT_PUBLIC_API_URL` é obrigatório: ele é
// embutido no JavaScript do navegador e não muda depois do build (ver
// src/lib/publicacao/api-url.ts). Falhar aqui impede publicar um site que
// chamaria `localhost`.
const erroDeApiUrl = erroDeApiUrlDePublicacao(process.env);
if (erroDeApiUrl) {
  throw new Error(erroDeApiUrl);
}

const nextConfig: NextConfig = {
  // Metadados no HTML inicial, sem streaming, em toda página renderizada na
  // requisição (o Next decide pelo User-Agent; `/.*/` vale para todos).
  //
  // Em streaming, o Next põe os metadados numa fronteira de Suspense própria
  // (`<div hidden>`), e o React hidrata essas fronteiras com a prioridade
  // mais baixa, depois de qualquer navegação. Se a guarda de sessão faz o
  // `router.replace` para a entrada antes disso (aparelho lento, sem login),
  // a fronteira sai sem ser hidratada e as tags que o servidor pôs no <head>
  // ficam órfãs: a página seguinte põe as suas e o documento fica com dois
  // `<link rel="manifest">`, dois títulos e dois ícones (defeito do React,
  // react/react#38155, ainda aberto). Sem streaming, os metadados hidratam
  // junto com a página, antes de qualquer efeito, e o React os troca na
  // navegação.
  //
  // Só vale para página renderizada na requisição: a estática sai do build
  // sempre com streaming. Por isso o portal (src/app/portal/layout.tsx)
  // renderiza na requisição. Não atrasa `/agendar/[slug]` nem `/[slug]`:
  // os metadados deles usam a mesma leitura que o layout e a página já
  // esperam antes de responder.
  htmlLimitedBots: /.*/,
  // Segurança em todas as respostas, `noindex` nas áreas privadas e o
  // service worker sem cache (ver src/lib/site/cabecalhos.ts). Calculado no
  // build: `API_BASE_URL` e `API_PROXY_TARGET` entram na CSP (connect-src), e
  // `IS_PULL_REQUEST` põe `noindex` em toda resposta da pré-visualização.
  async headers() {
    return regrasDeCabecalhos({
      apiBaseUrl: API_BASE_URL,
      destinoProxy: process.env.API_PROXY_TARGET,
      desenvolvimento: process.env.NODE_ENV === "development",
      indexavel: lerConfiguracaoDoSite(process.env).indexavel,
    });
  },
  // O portal da plataforma mora em `/portal`, com entrada própria; os
  // endereços antigos levam para lá (ver src/lib/administracao/rotas.ts). Solicitações, Serviços,
  // Profissionais e Equipe mudaram de endereço (src/lib/conta/rotas.ts).
  async redirects() {
    return [...ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA, ...ENCAMINHAMENTOS_CONTA_ANTIGA];
  },
};

export default nextConfig;
