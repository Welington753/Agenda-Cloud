// Ícone do aplicativo instalado do PORTAL da plataforma ("Portal AC"): o
// mesmo calendário do aplicativo da operação (icone.tsx), mas sobre fundo
// escuro e com um pequeno escudo na cor de destaque, para os dois ícones não
// se confundirem na tela de início. Desenhado com formas, sem arquivo binário
// nem fonte. O ícone da operação não muda (continua em icone.tsx).
//
// `seguro` encolhe o desenho para a área segura dos ícones "maskable".
import { ImageResponse } from "next/og";
import { DESTAQUE, TINTA } from "@/lib/pwa/icone";

const PAPEL = "#ffffff";
const PONTO_APAGADO = "#d9cfc2";

export function respostaDoIconePortal(tamanho: number, opcoes: { seguro?: boolean } = {}): ImageResponse {
  const escala = opcoes.seguro ? 0.62 : 0.72;
  const lado = Math.round(tamanho * escala);
  const borda = Math.max(2, Math.round(lado * 0.07));
  const raio = Math.round(lado * 0.12);
  const ponto = Math.round(lado * 0.13);
  // Escudo no canto inferior direito do calendário, com contorno da cor do
  // fundo para destacar do papel. No "maskable" ele não sai do calendário,
  // para caber no círculo da área segura (raio de 40% do ícone).
  const escudo = Math.round(lado * 0.46);
  const deslocamento = opcoes.seguro ? 0 : Math.round(lado * 0.12);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: TINTA,
        }}
      >
        <div style={{ width: lado, height: lado, display: "flex", position: "relative" }}>
          <div
            style={{
              width: lado,
              height: lado,
              display: "flex",
              flexDirection: "column",
              background: PAPEL,
              borderRadius: raio,
              overflow: "hidden",
            }}
          >
            <div style={{ height: Math.round(lado * 0.26), background: DESTAQUE, display: "flex" }} />
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
                    background: i === 4 ? DESTAQUE : PONTO_APAGADO,
                  }}
                />
              ))}
            </div>
          </div>
          <svg
            width={escudo}
            height={escudo}
            viewBox="0 0 24 24"
            style={{ position: "absolute", right: -deslocamento, bottom: -deslocamento }}
          >
            <path
              d="M12 1.5 3 5v6.2c0 5.4 3.8 10.1 9 11.3 5.2-1.2 9-5.9 9-11.3V5z"
              fill={DESTAQUE}
              stroke={TINTA}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
            <path
              d="m8 12.2 2.8 2.8L16.2 9.6"
              fill="none"
              stroke={PAPEL}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    ),
    { width: tamanho, height: tamanho },
  );
}
