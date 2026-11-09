// Ícone 192×192 do manifesto do portal (ver src/lib/pwa/manifest-portal.ts).
import { respostaDoIconePortal } from "@/lib/pwa/icone-portal";

export const dynamic = "force-static";

export function GET() {
  return respostaDoIconePortal(192);
}
