"use client";

// O que cada papel e permissão faz DE FATO nesta versão, gerado pelo
// servidor com as mesmas funções das rotas (nada aqui é texto solto).
// Plataforma e estabelecimento ficam separados.
import { Check, X } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehReferenciaPapeis, type Capacidades } from "@/lib/administracao/contas";
import { PAPEIS_ESTABELECIMENTO, PAPEIS_PLATAFORMA, PERMISSOES_ESTABELECIMENTO, PERMISSOES_PLATAFORMA } from "@/lib/administracao/rotulos";

const CAPACIDADES: Record<keyof Capacidades, string> = {
  viewDirectory: "Consultar",
  manageEstablishments: "Empresas e contas",
  managePlatformAccess: "Papéis da plataforma",
  manageEstablishmentLifecycle: "Situação e plano dos estabelecimentos",
};

function Marca({ sim }: { sim: boolean }) {
  return sim ? (
    <span className="inline-flex items-center gap-1">
      <Check size={16} aria-hidden="true" className="text-[color:var(--color-success)]" />
      sim
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-ink-soft">
      <X size={16} aria-hidden="true" />
      não
    </span>
  );
}

export default function PapeisPage() {
  const { estado, recarregar } = useLeituraPlataforma("/platform/roles", ehReferenciaPapeis);
  if (estado.status !== "pronto") return <EstadoLeitura estado={estado} recarregar={recarregar} />;
  const ref = estado.dados;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Papéis e permissões</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Só aparecem como atribuíveis os papéis e permissões que liberam alguma rota hoje. Ser dono(a) de um
          estabelecimento nunca dá acesso à administração da plataforma.
        </p>
      </header>
      <Cartao>
        <CartaoCorpo className="space-y-3">
          <h2 className="font-semibold">Plataforma</h2>
          <ul className="space-y-3">
            {ref.platformRoles.map((p) => (
              <li key={p.role} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-semibold">{PAPEIS_PLATAFORMA[p.role]}</p>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-ink-soft">Sem permissão extra</dt>
                    <dd className="flex flex-wrap gap-x-4">
                      {(Object.keys(CAPACIDADES) as (keyof Capacidades)[]).map((c) => (
                        <span key={c}>
                          {CAPACIDADES[c]}: <Marca sim={!!p.withoutPermissions[c]} />
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-soft">Com {ref.effectivePlatformPermissions.join(", ")}</dt>
                    <dd className="flex flex-wrap gap-x-4">
                      {(Object.keys(CAPACIDADES) as (keyof Capacidades)[]).map((c) => (
                        <span key={c}>
                          {CAPACIDADES[c]}: <Marca sim={!!p.withEffectivePermissions[c]} />
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-soft">
            Permissões sem efeito nesta versão (não atribuíveis):{" "}
            {Object.keys(PERMISSOES_PLATAFORMA)
              .filter((p) => !ref.effectivePlatformPermissions.includes(p))
              .join(", ")}
            . Ninguém altera a própria conta pela administração, e a última conta MASTER_OWNER ativa não pode ser
            rebaixada nem bloqueada.
          </p>
        </CartaoCorpo>
      </Cartao>
      <Cartao>
        <CartaoCorpo className="space-y-3">
          <h2 className="font-semibold">Dentro de cada estabelecimento</h2>
          <ul className="space-y-2 text-sm">
            {ref.tenantRoleAccess.map((r) => (
              <li key={r.role}>
                <span className="font-semibold">{PAPEIS_ESTABELECIMENTO[r.role] ?? r.role}:</span>{" "}
                {r.areas.length ? `${r.areas.length} de ${ref.tenantAreas.length} áreas` : "nenhuma área liberada hoje"}
              </li>
            ))}
          </ul>
          <p className="text-sm">Restrições que têm efeito no papel Dono(a) (cada uma bloqueia ao menos uma área):</p>
          <ul className="grid list-disc gap-1 pl-5 text-sm sm:grid-cols-2">
            {ref.effectiveTenantPermissions.map((p) => (
              <li key={p}>{PERMISSOES_ESTABELECIMENTO[p] ?? p}</li>
            ))}
          </ul>
          <p className="text-xs text-ink-soft">
            Gerente, Recepção e Profissional ainda não têm acesso nas rotas atuais; ampliar isso é outra entrega. Por isso a
            administração só convida como Dono(a).
          </p>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}
