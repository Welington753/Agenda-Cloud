import type { NextConfig } from "next";
import { erroDeApiUrlDePublicacao } from "./src/lib/publicacao/api-url";
import { ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA } from "./src/lib/administracao/rotas";
import { ENCAMINHAMENTOS_CONTA_ANTIGA } from "./src/lib/conta/rotas";

// No build da hospedagem, `NEXT_PUBLIC_API_URL` é obrigatório: ele é
// embutido no JavaScript do navegador e não muda depois do build (ver
// src/lib/publicacao/api-url.ts). Falhar aqui impede publicar um site que
// chamaria `localhost`.
const erroDeApiUrl = erroDeApiUrlDePublicacao(process.env);
if (erroDeApiUrl) {
  throw new Error(erroDeApiUrl);
}

const nextConfig: NextConfig = {
  // Service worker das notificações (public/sw.js): sempre a versão nova,
  // nunca de cache, e só scripts da própria origem. Ele mesmo não guarda
  // página, sessão nem resposta da API (não há manipulador de fetch).
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  // A administração da plataforma passou a morar na área da conta, com o
  // mesmo menu (ver src/lib/administracao/rotas.ts). Solicitações, Serviços,
  // Profissionais e Equipe mudaram de endereço (src/lib/conta/rotas.ts).
  async redirects() {
    return [...ENCAMINHAMENTOS_ADMINISTRACAO_ANTIGA, ...ENCAMINHAMENTOS_CONTA_ANTIGA];
  },
};

export default nextConfig;
