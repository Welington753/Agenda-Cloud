"use client";

// Papel da PLATAFORMA (separado dos papéis dentro de cada estabelecimento).
// Só um proprietário altera, nunca a própria conta, e só com a senha
// confirmada. O portal é exclusivo do proprietário: o único papel oferecido é
// esse; papéis delegados antigos aparecem como "sem acesso ao portal" e podem
// ser retirados. O servidor protege o último proprietário ativo.
import { useState } from "react";
import { Badge } from "@/components/ui/badge-base";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { PAPEIS_PLATAFORMA, PAPEL_ATRIBUIVEL, PERMISSOES_PLATAFORMA } from "@/lib/administracao/rotulos";
import type { PapelPlataforma } from "@/lib/administracao/contas";
import { BotaoConfirmado, CAMPO, Retorno, useExecucao, type SecaoProps } from "./comum";

const CAPACIDADES: Record<string, string> = {
  viewDirectory: "Consultar estabelecimentos, contas, preços, pagamentos e histórico",
  manageEstablishments: "Criar estabelecimentos, convidar e gerenciar contas",
  managePlatformAccess: "Definir quem é proprietário da plataforma",
  manageEstablishmentLifecycle: "Ativar, inativar, validade, sem vencimento, planos e preços",
};

export function SecaoPlataforma({ ficha, aoMudar }: SecaoProps) {
  const [papel, setPapel] = useState<PapelPlataforma | "">(ficha.platformRole === PAPEL_ATRIBUIVEL ? PAPEL_ATRIBUIVEL : "");
  const { executar, ocupado, mensagem } = useExecucao(aoMudar);
  const capacidades = Object.entries(ficha.platformCapabilities).filter(([, ativa]) => ativa);

  function salvar() {
    void executar(
      () =>
        acaoAdministrativa(`/platform/users/${encodeURIComponent(ficha.id)}/platform-access`, "PUT", {
          expectedUpdatedAt: ficha.updatedAt,
          role: papel || null,
          permissions: [],
        }),
      "Acesso de plataforma atualizado.",
    );
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <h2 className="font-semibold">Portal da plataforma</h2>
        <p className="text-sm">
          {ficha.platformRole ? PAPEIS_PLATAFORMA[ficha.platformRole] : "Sem papel de plataforma."}
        </p>
        {capacidades.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {capacidades.map(([chave]) => (
              <li key={chave}>{CAPACIDADES[chave]}</li>
            ))}
          </ul>
        ) : (
          ficha.platformRole && <p className="text-sm text-ink-soft">Este papel não abre o portal: só o de proprietário.</p>
        )}
        {ficha.ineffectivePlatformPermissions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ficha.ineffectivePlatformPermissions.map((p) => (
              <Badge key={p}>{PERMISSOES_PLATAFORMA[p] ?? p}</Badge>
            ))}
          </div>
        )}
        {ficha.allowedActions.changePlatformAccess && (
          <div className="grid items-end gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-3">
              <label className="block text-sm font-medium">
                Papel na plataforma
                <select className={CAMPO} value={papel} onChange={(e) => setPapel(e.target.value as PapelPlataforma | "")}>
                  <option value="">Sem papel de plataforma</option>
                  <option value={PAPEL_ATRIBUIVEL}>{PAPEIS_PLATAFORMA[PAPEL_ATRIBUIVEL]}</option>
                </select>
              </label>
            </div>
            <BotaoConfirmado
              rotulo="Salvar acesso"
              titulo="Alterar o acesso de plataforma?"
              confirmar="Alterar"
              disabled={ocupado}
              texto={
                <p>
                  {ficha.name} passa a ter: {papel ? PAPEIS_PLATAFORMA[papel] : "nenhum papel de plataforma"}. Vale na
                  próxima ação da pessoa, mesmo com a sessão aberta.
                </p>
              }
              aoConfirmar={salvar}
            />
          </div>
        )}
        <Retorno mensagem={mensagem} />
      </CartaoCorpo>
    </Cartao>
  );
}
