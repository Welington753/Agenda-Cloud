import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { formatarData } from "@/lib/format";
import type { RegistroAuditoria } from "@/lib/types";

interface SecaoAuditoriaProps {
  auditoria: RegistroAuditoria[];
}

export function SecaoAuditoria({ auditoria }: SecaoAuditoriaProps) {
  return (
    <Cartao>
      <CartaoCorpo>
        <CartaoTitulo className="mb-3">Auditoria deste estabelecimento</CartaoTitulo>
        {auditoria.length === 0 ? (
          <p className="text-sm text-ink-soft">Nenhum registro ainda.</p>
        ) : (
          <ul className="space-y-2">
            {auditoria.map((r) => (
              <li key={r.id} className="text-sm">
                <p className="text-ink">{r.resumo}</p>
                <p className="text-xs text-ink-soft">
                  {formatarData(r.em)} · {r.usuarioResponsavelNome}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
