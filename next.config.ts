import type { NextConfig } from "next";
import { erroDeApiUrlDePublicacao } from "./src/lib/publicacao/api-url";

// No build da hospedagem, `NEXT_PUBLIC_API_URL` é obrigatório: ele é
// embutido no JavaScript do navegador e não muda depois do build (ver
// src/lib/publicacao/api-url.ts). Falhar aqui impede publicar um site que
// chamaria `localhost`.
const erroDeApiUrl = erroDeApiUrlDePublicacao(process.env);
if (erroDeApiUrl) {
  throw new Error(erroDeApiUrl);
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
