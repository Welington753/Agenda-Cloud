"use client";

// Vínculos com estabelecimentos e o acesso EFETIVO de cada um, calculado pelo
// servidor com as mesmas regras das rotas. Restringir (DENIED) só aparece
// onde tem efeito: no papel Dono(a), nas permissões que alguma área consulta.
// Desvincular tira só aquele estabelecimento; os outros vínculos continuam.
import { useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge-base";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { PAPEIS_ESTABELECIMENTO, PERMISSOES_ESTABELECIMENTO } from "@/lib/administracao/rotulos";
import type { Vinculo } from "@/lib/administracao/contas";
import { rotaFichaEstabelecimento } from "@/lib/administracao/rotas";
import { BotaoConfirmado, Retorno, useExecucao, type SecaoProps } from "./comum";

function UmVinculo({ vinculo, pode, nome, aoMudar }: { vinculo: Vinculo; pode: boolean; nome: string; aoMudar: () => void }) {
  const [negadas, setNegadas] = useState<string[]>(vinculo.deniedPermissions);
  const { executar, ocupado, mensagem } = useExecucao(aoMudar);
  const caminho = `/platform/memberships/${encodeURIComponent(vinculo.id)}`;
  const alternar = (p: string) => setNegadas((atual) => (atual.includes(p) ? atual.filter((x) => x !== p) : [...atual, p]));
  const mudou = [...negadas].sort().join() !== [...vinculo.deniedPermissions].sort().join();

  return (
    <li className="space-y-3 rounded-lg border border-border p-4" data-testid="vinculo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={rotaFichaEstabelecimento(vinculo.tenant.id)} className="min-h-11 break-words font-semibold text-accent hover:underline">
          {vinculo.tenant.name}
        </Link>
        <Badge cor="destaque">{PAPEIS_ESTABELECIMENTO[vinculo.role] ?? vinculo.role}</Badge>
      </div>
      {!vinculo.roleHasAccess && (
        <p className="text-sm text-ink-soft">Este papel não libera nenhuma área hoje: só Dono(a) tem acesso nas rotas atuais.</p>
      )}
      <ul className="grid gap-1 text-sm sm:grid-cols-2" aria-label={`Acesso efetivo em ${vinculo.tenant.name}`}>
        {vinculo.effectiveAccess.map((area) => (
          <li key={area.key} className="flex items-center gap-2">
            {area.allowed ? (
              <Check size={16} aria-hidden="true" className="shrink-0 text-[color:var(--color-success)]" />
            ) : (
              <X size={16} aria-hidden="true" className="shrink-0 text-[color:var(--color-danger)]" />
            )}
            <span>
              {area.label}
              <span className="sr-only">{area.allowed ? ": liberado" : ": bloqueado"}</span>
            </span>
          </li>
        ))}
      </ul>
      {vinculo.ineffectiveOverrides.length > 0 && (
        <p className="text-xs text-ink-soft">Ajustes antigos sem efeito nas rotas: {vinculo.ineffectiveOverrides.join(", ")}.</p>
      )}
      {pode && vinculo.roleHasAccess && (
        <fieldset className="space-y-2 border-t border-border pt-3">
          <legend className="text-sm font-semibold">Restringir neste estabelecimento</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {Object.entries(PERMISSOES_ESTABELECIMENTO).map(([permissao, rotulo]) => (
              <label key={permissao} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="size-5" checked={negadas.includes(permissao)} onChange={() => alternar(permissao)} />
                Bloquear: {rotulo}
              </label>
            ))}
          </div>
          <BotaoConfirmado
            rotulo="Salvar restrições"
            titulo="Salvar as restrições?"
            confirmar="Salvar"
            disabled={ocupado || !mudou}
            texto={<p>As áreas marcadas ficam bloqueadas para {nome} em {vinculo.tenant.name} na próxima ação da pessoa.</p>}
            aoConfirmar={() =>
              void executar(
                () => acaoAdministrativa(`${caminho}/denied-permissions`, "PUT", { expectedDenied: vinculo.deniedPermissions, denied: negadas }),
                "Restrições salvas.",
              )
            }
          />
        </fieldset>
      )}
      {pode && (
        <BotaoConfirmado
          perigo
          rotulo="Desvincular"
          titulo={`Remover o acesso a ${vinculo.tenant.name}?`}
          confirmar="Desvincular"
          disabled={ocupado}
          texto={
            <p>
              {nome} perde o acesso a {vinculo.tenant.name} na próxima ação, e as notificações deste estabelecimento param. Os
              outros vínculos e a conta continuam.
            </p>
          }
          aoConfirmar={() => void executar(() => acaoAdministrativa(caminho, "DELETE"), "Vínculo removido.")}
        />
      )}
      <Retorno mensagem={mensagem} />
    </li>
  );
}

export function SecaoVinculos({ ficha, aoMudar }: SecaoProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <h2 className="font-semibold">Estabelecimentos</h2>
        {ficha.memberships.length === 0 ? (
          <p className="text-sm text-ink-soft">Sem vínculo com estabelecimento. Para vincular, convide pela ficha do estabelecimento.</p>
        ) : (
          <ul className="space-y-3">
            {ficha.memberships.map((v) => (
              <UmVinculo
                key={`${v.id}:${v.deniedPermissions.join()}`}
                vinculo={v}
                pode={ficha.allowedActions.manageMemberships}
                nome={ficha.name}
                aoMudar={aoMudar}
              />
            ))}
          </ul>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
