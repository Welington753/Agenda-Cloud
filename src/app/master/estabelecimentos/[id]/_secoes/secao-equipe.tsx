import { RotateCcw, UserCheck } from "lucide-react";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { BadgeStatusConvite, BadgeStatusUsuario } from "@/components/ui/badge";
import { formatarData } from "@/lib/format";
import type { Convite } from "@/lib/types";
import type { MembroEquipe } from "../acoes-estabelecimento";

interface SecaoEquipeProps {
  equipe: MembroEquipe[];
  convites: Convite[];
  aoAceitarConvite: (conviteId: string) => void;
  aoReenviarConvite: (conviteId: string) => void;
}

export function SecaoEquipe({ equipe, convites, aoAceitarConvite, aoReenviarConvite }: SecaoEquipeProps) {
  return (
    <Cartao>
      <CartaoCorpo>
        <CartaoTitulo className="mb-3">Equipe e convites</CartaoTitulo>
        <ul className="mb-4 divide-y divide-border">
          {equipe.map(({ membership, usuario: u }) => (
            <li key={membership.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div>
                <p className="font-medium text-ink">{u?.nome ?? "—"}</p>
                <p className="text-xs text-ink-soft">{u?.email} · {membership.papel}</p>
              </div>
              {u && <BadgeStatusUsuario status={u.status} />}
            </li>
          ))}
        </ul>
        {convites.length === 0 ? (
          <p className="text-sm text-ink-soft">Nenhum convite registrado.</p>
        ) : (
          <ul className="divide-y divide-border">
            {convites.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium text-ink">{c.nome}</p>
                  <p className="text-xs text-ink-soft">
                    {c.email} · {c.papel} · expira em {formatarData(c.expiraEm)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <BadgeStatusConvite status={c.status} />
                  {c.status === "pendente" && (
                    <button type="button" onClick={() => aoAceitarConvite(c.id)} className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                      <UserCheck size={14} /> Aceitar (simular)
                    </button>
                  )}
                  {(c.status === "pendente" || c.status === "expirado") && (
                    <button type="button" onClick={() => aoReenviarConvite(c.id)} className="flex items-center gap-1 text-xs font-semibold text-ink-soft hover:underline">
                      <RotateCcw size={14} /> Reenviar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
