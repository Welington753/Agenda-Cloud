// Estado do convite e do envio do e-mail, lado a lado: são coisas
// diferentes. "Enviado" é só "o provedor aceitou".
import { Badge } from "@/components/ui/badge-base";
import { SITUACOES_CONVITE, corEnvio, textoEnvio, dataHora } from "@/lib/administracao/rotulos";
import type { Convite } from "@/lib/administracao/contas";

const ROTULO_ENVIO: Record<string, string> = {
  SENT: "E-mail aceito pelo provedor",
  FAILED: "Falha no envio",
  NOT_CONFIGURED: "Envio não configurado",
  PENDING: "Envio não confirmado",
};

const COR_CONVITE = { PENDING: "info", ACCEPTED: "sucesso", EXPIRED: "neutro", REVOKED: "neutro" } as const;

export function SituacaoDoConvite({ convite, detalhar = false }: { convite: Convite; detalhar?: boolean }) {
  const mostrarEnvio = convite.status === "PENDING";
  return (
    <div className="space-y-1" data-testid="situacao-convite">
      <div className="flex flex-wrap gap-2">
        <Badge cor={COR_CONVITE[convite.status]}>{SITUACOES_CONVITE[convite.status]}</Badge>
        {mostrarEnvio && <Badge cor={corEnvio(convite.delivery.status)}>{ROTULO_ENVIO[convite.delivery.status]}</Badge>}
      </div>
      {detalhar && mostrarEnvio && <p className="text-xs text-ink-soft">{textoEnvio(convite.delivery)}</p>}
      {detalhar && convite.status === "PENDING" && (
        <p className="text-xs text-ink-soft">
          Link válido até {dataHora(convite.expiresAt)} · {convite.sendCount} de {convite.maxSends} links emitidos
        </p>
      )}
    </div>
  );
}
