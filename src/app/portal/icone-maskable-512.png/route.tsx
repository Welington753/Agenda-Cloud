// Ícone 512×512 "maskable" do portal: desenho dentro da área segura, para o
// Android recortar sem cortar o calendário nem o escudo.
import { respostaDoIconePortal } from "@/lib/pwa/icone-portal";

export const dynamic = "force-static";

export function GET() {
  return respostaDoIconePortal(512, { seguro: true });
}
