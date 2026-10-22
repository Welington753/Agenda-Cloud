// Ícone da tela de início do iPhone/iPad (`apple-touch-icon`), gerado pela
// convenção de metadados do Next.js.
import { respostaDoIcone } from "@/lib/pwa/icone";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return respostaDoIcone(180);
}
