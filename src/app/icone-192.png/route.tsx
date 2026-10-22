// Ícone 192×192 do manifesto (ver src/app/manifest.ts).
import { respostaDoIcone } from "@/lib/pwa/icone";

export const dynamic = "force-static";

export function GET() {
  return respostaDoIcone(192);
}
