// Os dois aplicativos instaláveis: o da operação (src/app/manifest.ts) não pode
// mudar de identidade (quem já instalou perderia o aplicativo), e o do portal
// precisa de identidade própria, abrindo no portal.
import { describe, expect, it } from "vitest";
import manifestDaOperacao from "@/app/manifest";
import { manifestDoPortal, ROTA_MANIFEST_PORTAL } from "@/lib/pwa/manifest-portal";

// Mesma regra de escopo do Web App Manifest: prefixo de texto do caminho.
function dentroDoEscopo(escopo: string, caminho: string): boolean {
  return caminho.startsWith(escopo);
}

describe("manifest do aplicativo da operação", () => {
  it("mantém id, abertura, escopo, nome e ícones de antes", () => {
    const m = manifestDaOperacao();
    expect(m.id).toBe("/conta/visao-geral");
    expect(m.start_url).toBe("/conta/visao-geral");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.name).toBe("Agenda Cloud");
    expect(m.icons?.map((i) => i.src)).toEqual(["/icone-192.png", "/icone-512.png", "/icone-maskable-512.png"]);
  });
});

describe("manifest do aplicativo do portal (Portal AC)", () => {
  const m = manifestDoPortal();

  it("tem identidade própria e abre na Visão geral do portal em tela cheia", () => {
    expect(m.id).toBe("/portal/visao-geral");
    expect(m.id).not.toBe(manifestDaOperacao().id);
    expect(m.start_url).toBe("/portal/visao-geral");
    expect(m.display).toBe("standalone");
    expect(m.name).toBe("Portal AC");
    expect(m.short_name).toBe("Portal AC");
    expect(ROTA_MANIFEST_PORTAL).toBe("/portal/manifest.webmanifest");
  });

  it("o escopo cobre a entrada e a área do portal, não a operação nem o login", () => {
    const escopo = m.scope ?? "";
    for (const caminho of ["/portal", "/portal?next=%2Fportal%2Fusuarios", "/portal/visao-geral", "/portal/estabelecimentos/x"]) {
      expect(dentroDoEscopo(escopo, caminho)).toBe(true);
    }
    for (const caminho of ["/conta/visao-geral", "/login", "/agendar/x", "/"]) {
      expect(dentroDoEscopo(escopo, caminho)).toBe(false);
    }
    expect(dentroDoEscopo(escopo, m.start_url ?? "")).toBe(true);
  });

  it("ícones próprios, servidos dentro do portal, com um maskable", () => {
    const icones = m.icons ?? [];
    expect(icones.map((i) => i.src)).toEqual([
      "/portal/icone-192.png",
      "/portal/icone-512.png",
      "/portal/icone-maskable-512.png",
    ]);
    expect(icones.some((i) => i.purpose === "maskable")).toBe(true);
  });
});
