// Ícone da tela de início do iPhone/iPad (`apple-touch-icon`) do aplicativo
// "Portal AC". Por ser o arquivo mais próximo da folha, vale para `/portal` e
// `/portal/**` no lugar do src/app/apple-icon.tsx (que segue o da operação).
import { respostaDoIconePortal } from "@/lib/pwa/icone-portal";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIconPortal() {
  return respostaDoIconePortal(180);
}
