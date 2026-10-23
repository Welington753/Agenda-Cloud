"use client";

// Dados básicos e situação da conta. Só nome e telefone são editáveis: o
// e-mail é o login, e trocá-lo exigiria confirmar o novo endereço (fluxo que
// esta versão não tem). Bloquear encerra as sessões abertas na hora.
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { SITUACOES_CONTA, corConta, dataHora } from "@/lib/administracao/rotulos";
import { BotaoConfirmado, CAMPO, Retorno, useExecucao, type SecaoProps } from "./comum";

export function SecaoDados({ ficha, aoMudar }: SecaoProps) {
  const [nome, setNome] = useState(ficha.name);
  const [telefone, setTelefone] = useState(ficha.phone ?? "");
  const { executar, ocupado, mensagem } = useExecucao(aoMudar);
  const caminho = `/platform/users/${encodeURIComponent(ficha.id)}`;

  function salvar(evento: FormEvent) {
    evento.preventDefault();
    void executar(
      () =>
        acaoAdministrativa(caminho, "PATCH", {
          expectedUpdatedAt: ficha.updatedAt,
          name: nome.trim(),
          phone: telefone.trim() ? telefone.trim() : null,
        }),
      "Dados salvos.",
    );
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Conta</h2>
          <Badge cor={corConta(ficha.status)}>{SITUACOES_CONTA[ficha.status]}</Badge>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-ink-soft">E-mail de login</dt>
            <dd className="break-all font-medium">{ficha.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Verificação do e-mail</dt>
            <dd className="font-medium">{ficha.emailVerified ? "Verificado (link recebido no endereço)" : "Não verificado"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Criada em</dt>
            <dd className="font-medium">{dataHora(ficha.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Senha e sessões</dt>
            <dd className="font-medium">
              {ficha.hasPassword ? "Senha definida" : "Sem senha (convite não aceito)"} · {ficha.activeSessions} sessão(ões)
              aberta(s)
            </dd>
          </div>
        </dl>
        {ficha.allowedActions.edit ? (
          <form onSubmit={salvar} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="min-w-0 text-sm font-medium">
              Nome
              <input required minLength={2} maxLength={120} className={CAMPO} value={nome} onChange={(e) => setNome(e.target.value)} />
            </label>
            <label className="min-w-0 text-sm font-medium">
              Telefone
              <input inputMode="tel" maxLength={20} className={CAMPO} value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </label>
            <Botao type="submit" disabled={ocupado} className="min-h-11">
              Salvar
            </Botao>
          </form>
        ) : (
          <p className="text-sm text-ink-soft">Sua conta não altera esta conta.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {ficha.allowedActions.block && (
            <BotaoConfirmado
              perigo
              rotulo="Bloquear conta"
              titulo="Bloquear esta conta?"
              confirmar="Bloquear"
              disabled={ocupado}
              texto={
                <p>
                  {ficha.name} não consegue mais entrar, as {ficha.activeSessions} sessão(ões) abertas são encerradas agora e
                  as notificações deixam de ser entregues. Nada é apagado; dá para reativar depois.
                </p>
              }
              aoConfirmar={() =>
                void executar(
                  () => acaoAdministrativa(`${caminho}/block`, "POST", { expectedUpdatedAt: ficha.updatedAt }),
                  "Conta bloqueada e sessões encerradas.",
                )
              }
            />
          )}
          {ficha.allowedActions.reactivate && (
            <BotaoConfirmado
              rotulo="Reativar conta"
              titulo="Reativar esta conta?"
              confirmar="Reativar"
              disabled={ocupado}
              texto={
                <p>
                  {ficha.hasPassword
                    ? "A pessoa volta a entrar com a senha que já tinha."
                    : "A conta volta a aguardar a ativação pelo convite."}
                </p>
              }
              aoConfirmar={() =>
                void executar(
                  () => acaoAdministrativa(`${caminho}/reactivate`, "POST", { expectedUpdatedAt: ficha.updatedAt }),
                  "Conta reativada.",
                )
              }
            />
          )}
        </div>
        <Retorno mensagem={mensagem} />
      </CartaoCorpo>
    </Cartao>
  );
}
