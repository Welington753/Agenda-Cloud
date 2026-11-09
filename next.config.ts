import type { NextConfig } from "next";
import { erroDeApiUrlDePublicacao } from "./src/lib/publicacao/api-url";
import { ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA } from "./src/lib/administracao/rotas";
import { ENCAMINHAMENTOS_CONTA_ANTIGA } from "./src/lib/conta/rotas";
import { API_BASE_URL } from "./src/lib/config";
import { regrasDeCabecalhos } from "./src/lib/site/cabecalhos";

// No build da hospedagem, `NEXT_PUBLIC_API_URL` é obrigatório: ele é
// embutido no JavaScript do navegador e não muda depois do build (ver
// src/lib/publicacao/api-url.ts). Falhar aqui impede publicar um site que
// chamaria `localhost`.
const erroDeApiUrl = erroDeApiUrlDePublicacao(process.env);
if (erroDeApiUrl) {
  throw new Error(erroDeApiUrl);
}

const nextConfig: NextConfig = {
  // Segurança em todas as respostas, `noindex` nas áreas privadas e o
  // service worker sem cache (ver src/lib/site/cabecalhos.ts). Calculado no
  // build: `API_BASE_URL` e `API_PROXY_TARGET` entram na CSP (connect-src).
  async headers() {
    return regrasDeCabecalhos({
      apiBaseUrl: API_BASE_URL,
      destinoProxy: process.env.API_PROXY_TARGET,
      desenvolvimento: process.env.NODE_ENV === "development",
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
