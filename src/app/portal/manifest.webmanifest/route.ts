// Manifesto do aplicativo "Portal AC" (ver src/lib/pwa/manifest-portal.ts).
// O `manifest.ts` da raiz continua sendo o do aplicativo da operação: a
// convenção de arquivo do Next só aceita um manifest, na raiz de `app/`.
import { manifestDoPortal } from "@/lib/pwa/manifest-portal";

export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(manifestDoPortal()), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
