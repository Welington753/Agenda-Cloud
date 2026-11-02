"use client";

// Plano do estabelecimento: uso atual contra os limites e a troca por outro
// plano do catálogo. Cada plano mostra antes, pelo servidor, se comporta o
// uso atual; a troca para um que não comporta é recusada (e nada é desligado
// para caber). Pede a senha (mesma reautenticação das contas).
import { useState } from "react";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useAcaoSensivel } from "./reautenticacao";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { precoCatalogo, type DetalheEstabelecimento } from "@/lib/administracao/contratos";
import { Retorno, useResultado } from "./resultado-acao";

export function PlanoDoEstabelecimento({ item, aoMudar }: { item: DetalheEstabelecimento; aoMudar: () => void }) {
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(aoMudar);
  const [escolhido, setEscolhido] = useState(item.plan.id);
  const [confirmando, setConfirmando] = useState(false);
  const opcao = item.planOptions.find((p) => p.id === escolhido);
  const vagas = item.usage.staffSeats;

  async function trocar() {
    setConfirmando(false);
    await executar(
      () =>
        executarSensivel(() =>
          acaoAdministrativa(`/platform/establishments/${encodeURIComponent(item.id)}/plan`, "PUT", {
            expectedUpdatedAt: item.updatedAt,
            planId: escolhido,
          }),
        ),
      "Plano trocado. Os limites novos já valem.",
    );
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-4" data-testid="plano-estabelecimento">
        <h2 className="font-semibold">Plano e uso</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div>
            <dt className="text-xs text-ink-soft">Plano atual</dt>
            <dd className="mt-1 text-sm font-medium">{item.plan.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Preço do catálogo</dt>
            <dd className="mt-1 text-sm font-medium">{precoCatalogo(item.plan.catalogPriceCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Profissionais ativos</dt>
            <dd className="mt-1 text-sm font-medium">
              {item.usage.professionals} de {item.plan.maxProfessionals}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Acessos de funcionário</dt>
            <dd className="mt-1 text-sm font-medium" data-testid="uso-vagas">
              {vagas.used} de {vagas.limit}
              <span className="block text-xs font-normal text-ink-soft">
                {vagas.activeAccesses} ativo(s), {vagas.pendingInvites} convite(s) pendente(s)
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Unidades</dt>
            <dd className="mt-1 text-sm font-medium">
              {item.usage.units}
              <span className="block text-xs font-normal text-ink-soft">Multiunidade ainda não disponível</span>
            </dd>
          </div>
        </dl>
        <p className="text-xs text-ink-soft">
          O preço mostrado é o do catálogo: não comprova valor contratado, cobrança nem pagamento.
        </p>
        {item.allowedActions.changePlan && (
          <fieldset className="space-y-2" disabled={ocupado}>
            <legend className="text-sm font-semibold">Trocar plano</legend>
            <ul className="grid gap-2 md:grid-cols-2">
              {item.planOptions.map((p) => (
                <li key={p.id}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
                    <input
                      type="radio"
                      name="plano"
                      className="mt-1 size-5"
                      checked={escolhido === p.id}
                      onChange={() => setEscolhido(p.id)}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {p.name}
                        {p.id === item.plan.id ? " (atual)" : ""}
                      </span>
                      <span className="block text-xs text-ink-soft">
                        Até {p.maxProfessionals} profissional(is) e acessos de equipe · catálogo{" "}
                        {precoCatalogo(p.catalogPriceCents)}
                      </span>
                      {p.excess.length > 0 && (
                        <span className="mt-1 block text-xs text-[color:var(--color-warning)]">
                          Não comporta o uso atual: {p.excess.map((e) => e.action).join(" ")}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <Botao
              className="min-h-11"
              disabled={!opcao || escolhido === item.plan.id || opcao.excess.length > 0}
              onClick={() => setConfirmando(true)}
            >
              Trocar para {opcao?.name ?? "o plano escolhido"}
            </Botao>
            {opcao && opcao.excess.length > 0 && (
              <p className="text-xs text-ink-soft">
                Ninguém é desligado para caber num plano menor: ajuste primeiro o que está indicado.
              </p>
            )}
          </fieldset>
        )}
        <Retorno mensagem={mensagem} />
        <Modal
          aberto={confirmando}
          aoFechar={() => setConfirmando(false)}
          titulo="Trocar o plano?"
          rodape={
            <>
              <Botao variante="secundaria" className="min-h-11" onClick={() => setConfirmando(false)}>
                Cancelar
              </Botao>
              <Botao className="min-h-11" onClick={() => void trocar()}>
                Trocar plano
              </Botao>
            </>
          }
        >
          <p>
            {item.name} passa do plano {item.plan.name} para {opcao?.name}. Os limites de profissionais e de acessos de
            funcionário mudam já. Nenhum valor contratado, cobrança ou pagamento é registrado aqui.
          </p>
        </Modal>
      </CartaoCorpo>
    </Cartao>
  );
}
