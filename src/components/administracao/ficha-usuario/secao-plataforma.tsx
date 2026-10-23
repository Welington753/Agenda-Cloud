"use client";

// Papel e permissões da PLATAFORMA (separados dos papéis dentro de cada
// estabelecimento). Só o MASTER_OWNER altera, nunca a própria conta, e só
// com a senha confirmada. A única permissão oferecida é a que libera alguma
// rota; as outras do modelo aparecem como "sem efeito" quando já existem.
import { useState } from "react";
import { Badge } from "@/components/ui/badge-base";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { PAPEIS_PLATAFORMA, PERMISSOES_PLATAFORMA } from "@/lib/administracao/rotulos";
import type { PapelPlataforma } from "@/lib/administracao/contas";
import { BotaoConfirmado, CAMPO, Retorno, useExecucao, type SecaoProps } from "./comum";

const CAPACIDADES: Record<string, string> = {
  viewDirectory: "Consultar estabelecimentos, usuários, convites e histórico",
  manageEstablishments: "Criar estabelecimentos, convidar e gerenciar contas sem papel de plataforma",
  managePlatformAccess: "Gerenciar papéis e permissões da plataforma",
};

export function SecaoPlataforma({ ficha, aoMudar }: SecaoProps) {
  const [papel, setPapel] = useState<PapelPlataforma | "">(ficha.platformRole ?? "");
  const [gerencia, setGerencia] = useState(ficha.platformPermissions.includes("ESTABLISHMENTS_MANAGE"));
  const { executar, ocupado, mensagem } = useExecucao(aoMudar);
  const capacidades = Object.entries(ficha.platformCapabilities).filter(([, ativa]) => ativa);
  const permissoesAplicaveis = papel === "MASTER_ADMIN" || papel === "MASTER_SUPPORT";

  function salvar() {
    void executar(
      () =>
        acaoAdministrativa(`/platform/users/${encodeURIComponent(ficha.id)}/platform-access`, "PUT", {
          expectedUpdatedAt: ficha.updatedAt,
          role: papel || null,
          permissions: permissoesAplicaveis && gerencia ? ["ESTABLISHMENTS_MANAGE"] : [],
        }),
      "Acesso de plataforma atualizado.",
    );
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <h2 className="font-semibold">Administração da plataforma</h2>
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
          ficha.platformRole && <p className="text-sm text-ink-soft">Este papel sem permissão não libera nada.</p>
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
                  {Object.entries(PAPEIS_PLATAFORMA).map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>
                      {rotulo}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={permissoesAplicaveis && gerencia}
                  disabled={!permissoesAplicaveis}
                  onChange={(e) => setGerencia(e.target.checked)}
                />
                {PERMISSOES_PLATAFORMA.ESTABLISHMENTS_MANAGE}
              </label>
            </div>
            <BotaoConfirmado
              rotulo="Salvar acesso"
              titulo="Alterar o acesso de plataforma?"
              confirmar="Alterar"
              disabled={ocupado}
              texto={
                <p>
                  {ficha.name} passa a ter: {papel ? PAPEIS_PLATAFORMA[papel] : "nenhum papel de plataforma"}
                  {permissoesAplicaveis && gerencia ? ", com estabelecimentos e contas" : ""}. Vale na próxima ação da pessoa.
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
