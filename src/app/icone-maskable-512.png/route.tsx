// Ícone 512×512 "maskable": desenho dentro da área segura, para o Android
// recortar sem cortar o calendário.
import { respostaDoIcone } from "@/lib/pwa/icone";

export const dynamic = "force-static";

export function GET() {
  return respostaDoIcone(512, { seguro: true });
}
