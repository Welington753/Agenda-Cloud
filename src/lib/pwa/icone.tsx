// Ícone do aplicativo instalado (PWA), desenhado com formas — sem arquivo
// binário nem fonte: um calendário branco sobre a cor de destaque. Gerado
// como PNG pelo `ImageResponse` (rotas /icone-192.png, /icone-512.png e o
// apple-icon). `seguro` encolhe o desenho para a área segura dos ícones
// "maskable" (Android recorta em círculo ou gota).
import { ImageResponse } from "next/og";

const DESTAQUE = "#b5651d";
const TINTA = "#1c1a17";

export function respostaDoIcone(tamanho: number, opcoes: { seguro?: boolean } = {}): ImageResponse {
  const escala = opcoes.seguro ? 0.62 : 0.72;
  const lado = Math.round(tamanho * escala);
  const borda = Math.max(2, Math.round(lado * 0.07));
  const raio = Math.round(lado * 0.12);
  const ponto = Math.round(lado * 0.13);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: DESTAQUE,
        }}
      >
        <div
          style={{
            width: lado,
            height: lado,
            display: "flex",
            flexDirection: "column",
            background: "#ffffff",
            borderRadius: raio,
            overflow: "hidden",
          }}
        >
          <div style={{ height: Math.round(lado * 0.26), background: TINTA, display: "flex" }} />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexWrap: "wrap",
              alignContent: "center",
              justifyContent: "center",
              gap: borda * 1.5,
              padding: borda * 2,
            }}
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                style={{
                  width: ponto,
                  height: ponto,
                  borderRadius: Math.round(ponto / 4),
                  background: i === 4 ? DESTAQUE : "#d9cfc2",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    ),
    { width: tamanho, height: tamanho },
  );
}
