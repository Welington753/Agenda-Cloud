// Imagem de compartilhamento (Open Graph, 1200×630): o ícone do aplicativo,
// o nome e o slogan do produto, nas cores da marca. Nenhum dado de
// estabelecimento ou de cliente. Gerada pelo `ImageResponse`, como o ícone.
import { ImageResponse } from "next/og";
import { NOME_PRODUTO, SLOGAN_PRODUTO } from "@/lib/config";
import { DESTAQUE, TINTA, desenhoDoIcone } from "./icone";

const PAPEL = "#faf7f2";

export function imagemDeCompartilhamento(tamanho: { width: number; height: number }): ImageResponse {
  const icone = 220;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          padding: "0 96px",
          background: PAPEL,
          borderBottom: `24px solid ${DESTAQUE}`,
        }}
      >
        <div style={{ display: "flex", borderRadius: 48, overflow: "hidden", flexShrink: 0 }}>
          {desenhoDoIcone(icone, Math.round(icone * 0.72))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 84, fontWeight: 700, color: TINTA, letterSpacing: -2 }}>{NOME_PRODUTO}</div>
          <div style={{ fontSize: 36, color: "#5c554c", lineHeight: 1.3, maxWidth: 680 }}>{SLOGAN_PRODUTO}</div>
        </div>
      </div>
    ),
    tamanho,
  );
}
