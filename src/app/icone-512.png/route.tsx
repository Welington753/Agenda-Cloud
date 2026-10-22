// Ícone 512×512 do manifesto (o "maskable" é /icone-maskable-512.png).
import { respostaDoIcone } from "@/lib/pwa/icone";

export const dynamic = "force-static";

export function GET() {
  return respostaDoIcone(512);
}
