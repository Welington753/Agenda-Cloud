"use client";

// Aba "Plano e adicionais" da ficha do estabelecimento. Estabelecimento
// modular: escolhe adicionais, limite de usuários e valor (negociado com
// motivo) e revisa antes de salvar uma nova versão. Estabelecimento no plano
// anterior: continua como está (limite próprio opcional) até a conversão
// explícita. Pede a senha (mesma reautenticação das demais ações). O
// servidor confere tudo de novo; nada aqui registra pagamento.
import { useState } from "react";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { EstadoLeitura } from "./estado-leitura";
import { useAcaoSensivel } from "./reautenticacao";
import { Retorno, useResultado } from "./resultado-acao";
import {
  CampoLimite,
  CampoValorNegociado,
  EscolhaDeAdicionais,
  EssencialIncluido,
  ResumoDaAssinatura,
} from "./assinatura-modular";
import { acaoAdministrativa, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import {
  calcularEscolha,
  ehVisaoAssinatura,
  revisarAssinatura,
  validarLimite,
  type VisaoAssinatura,
} from "@/lib/administracao/assinatura";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { centavosDe } from "@/lib/administracao/validade";
import { acimaDoLimite, textoDasVagas } from "@/lib/equipe/contratos";

export function PlanoEAdicionais({ tenantId, nome, aoMudar }: { tenantId: string; nome: string; aoMudar: () => void }) {
  const leitura = useLeituraPlataforma(
    `/platform/establishments/${encodeURIComponent(tenantId)}/subscription`,
    ehVisaoAssinatura,
  );
  if (leitura.estado.status !== "pronto") return <EstadoLeitura estado={leitura.estado} recarregar={leitura.recarregar} />;
  const visao = leitura.estado.dados;
  const recarregar = () => {
    leitura.recarregar();
    aoMudar();
  };
  // A versão lida entra na chave: depois de salvar, o formulário recomeça.
  return <Conteudo key={visao.updatedAt} visao={visao} nome={nome} aoMudar={recarregar} />;
}

function Conteudo({ visao, nome, aoMudar }: { visao: VisaoAssinatura; nome: string; aoMudar: () => void }) {
  const [convertendo, setConvertendo] = useState(false);
  return (
    <div className="space-y-6" data-testid="plano-e-adicionais">
      {visao.modular || convertendo ? (
        <Editor visao={visao} nome={nome} aoMudar={aoMudar} aoCancelar={visao.modular ? undefined : () => setConvertendo(false)} />
      ) : (
        <PlanoAnterior visao={visao} aoMudar={aoMudar} aoConverter={() => setConvertendo(true)} />
      )}
    </div>
  );
}

function UsoDaEquipe({ visao }: { visao: VisaoAssinatura }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-semibold" data-testid="uso-limite">
          {textoDasVagas(visao.seats)}
        </span>
        {visao.teamUserLimit.source === "PLAN" ? " · limite do plano" : ""}
      </p>
      {acimaDoLimite(visao.seats) && (
        <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm" data-testid="acima-do-limite-portal">
          Acima do limite contratado: ninguém perdeu o acesso, mas novas contas, convites e reativações estão bloqueados
          até o uso caber no limite.
        </p>
      )}
    </div>
  );
}

function PlanoAnterior({ visao, aoMudar, aoConverter }: { visao: VisaoAssinatura; aoMudar: () => void; aoConverter: () => void }) {
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(aoMudar);
  const [limite, setLimite] = useState(String(visao.teamUserLimit.value));
  const validacao = validarLimite(limite, visao.seats);

  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <h2 className="font-semibold">Plano anterior: {visao.plan.name}</h2>
        <p className="text-sm text-ink-soft">
          Este estabelecimento continua no plano anterior, com os recursos de hoje. A conversão para a assinatura modular
          é feita aqui, com revisão antes de salvar; nada muda sozinho.
        </p>
        <UsoDaEquipe visao={visao} />
        {visao.canManage && (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <CampoLimite valor={limite} aoMudar={setLimite} erro={validacao.erro} desativado={ocupado} />
            <Botao
              className="min-h-11"
              disabled={ocupado || validacao.valor === null || validacao.valor === visao.teamUserLimit.value}
              onClick={() =>
                void executar(
                  () =>
                    executarSensivel(() =>
                      acaoAdministrativa(`/platform/establishments/${encodeURIComponent(visao.tenantId)}/team-limit`, "PUT", {
                        expectedUpdatedAt: visao.updatedAt,
                        teamUserLimit: validacao.valor,
                      }),
                    ),
                  "Limite de usuários salvo. A mensalidade não mudou.",
                )
              }
            >
              Salvar limite
            </Botao>
          </div>
        )}
        <Retorno mensagem={mensagem} />
        {visao.canManage && visao.status !== "ARCHIVED" && (
          <Botao variante="secundaria" className="min-h-11" onClick={aoConverter}>
            Converter para assinatura modular
          </Botao>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}

function Editor({
  visao,
  nome,
  aoMudar,
  aoCancelar,
}: {
  visao: VisaoAssinatura;
  nome: string;
  aoMudar: () => void;
  aoCancelar?: () => void;
}) {
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(aoMudar);
  const inicial = visao.current ? visao.current.items.map((i) => i.code) : visao.enabledAddons;
  const [selecionados, setSelecionados] = useState<string[]>(inicial);
  const [limite, setLimite] = useState(String(visao.current?.teamUserLimit ?? visao.teamUserLimit.value));
  const [ajustando, setAjustando] = useState(visao.current?.negotiated ?? false);
  const [valor, setValor] = useState(
    visao.current?.negotiated ? (visao.current.contractedTotalCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [motivo, setMotivo] = useState(visao.current?.negotiated ? (visao.current.reason ?? "") : "");
  const [revisando, setRevisando] = useState(false);
  const [chave, setChave] = useState(novaChaveDeFormulario);
  const [confirmaRetirada, setConfirmaRetirada] = useState(false);
  const [confirmaCiclo, setConfirmaCiclo] = useState(false);

  const centavos = ajustando && valor.trim() ? centavosDe(valor) : null;
  const valorInvalido = ajustando && valor.trim() !== "" && centavos === null;
  const escolha = calcularEscolha(visao.catalog.basePriceCents, visao.catalog.addons, selecionados, {
    centavos,
    motivo,
  });
  const validacao = validarLimite(limite, visao.seats);
  const conversao = visao.modular ? null : visao.conversion;
  const revisao = revisarAssinatura({
    atual: visao.current,
    ligadosHoje: visao.enabledAddons,
    adicionais: visao.catalog.addons,
    escolha,
    limite: validacao.valor ?? 0,
    limiteAtual: visao.teamUserLimit.value,
    conversao,
  });
  const exigeCiclo = conversao?.requiresCycleChange === true;
  const podeRevisar = visao.canManage && !valorInvalido && validacao.valor !== null && escolha.pendencias.length === 0;
  const podeSalvar = podeRevisar && (!revisao.retirados.length || confirmaRetirada) && (!exigeCiclo || confirmaCiclo);

  function alternar(code: string) {
    setSelecionados((atual) => (atual.includes(code) ? atual.filter((c) => c !== code) : [...atual, code]));
  }

  async function salvar() {
    const ok = await executar(
      () =>
        executarSensivel(() =>
          acaoAdministrativa(`/platform/establishments/${encodeURIComponent(visao.tenantId)}/subscription`, "PUT", {
            expectedUpdatedAt: visao.updatedAt,
            requestKey: chave,
            addons: escolha.itens.map((i) => i.code),
            teamUserLimit: validacao.valor,
            ...(escolha.negociado ? { contractedTotalCents: escolha.totalContratadoCents, reason: motivo.trim() } : {}),
            ...(revisao.retirados.length ? { confirmRemoval: true } : {}),
            ...(exigeCiclo ? { cycleChange: { from: "QUARTERLY", acknowledged: true } } : {}),
          }),
        ),
      conversao ? "Assinatura modular criada. Vale a partir de agora." : "Assinatura salva. Vale a partir de agora.",
    );
    if (!ok) setChave(novaChaveDeFormulario());
    setRevisando(false);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="min-w-0 space-y-6">
        <EssencialIncluido basePriceCents={visao.catalog.basePriceCents} />
        <EscolhaDeAdicionais
          adicionais={visao.catalog.addons}
          selecionados={selecionados}
          aoAlternar={alternar}
          desativado={!visao.canManage || ocupado}
        />
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <UsoDaEquipe visao={visao} />
            <CampoLimite valor={limite} aoMudar={setLimite} erro={validacao.erro} desativado={!visao.canManage || ocupado} />
          </CartaoCorpo>
        </Cartao>
      </div>
      <div className="min-w-0 space-y-4">
        <ResumoDaAssinatura nome={nome} basePriceCents={visao.catalog.basePriceCents} escolha={escolha} limite={limite}>
          {ajustando && (
            <CampoValorNegociado
              valor={valor}
              motivo={motivo}
              aoMudarValor={setValor}
              aoMudarMotivo={setMotivo}
              invalido={valorInvalido}
            />
          )}
          {escolha.pendencias.map((p) => (
            <p key={p} className="text-xs text-[color:var(--color-danger)]">
              {p}
            </p>
          ))}
          {visao.canManage && (
            <div className="space-y-2">
              <Botao
                variante="secundaria"
                className="min-h-11 w-full"
                onClick={() => {
                  setAjustando((a) => !a);
                  setValor("");
                  setMotivo("");
                }}
              >
                {ajustando ? "Seguir o total do catálogo" : "Ajustar valor contratado"}
              </Botao>
              <Botao className="min-h-11 w-full" disabled={!podeRevisar || ocupado} onClick={() => setRevisando(true)}>
                Revisar assinatura
              </Botao>
              {aoCancelar && (
                <Botao variante="fantasma" className="min-h-11 w-full" onClick={aoCancelar}>
                  Cancelar conversão
                </Botao>
              )}
            </div>
          )}
          <p className="text-xs text-ink-soft">Confira os valores e a vigência antes de salvar.</p>
        </ResumoDaAssinatura>
        <Retorno mensagem={mensagem} />
      </div>
      <Modal
        aberto={revisando}
        aoFechar={() => setRevisando(false)}
        titulo={conversao ? "Converter para assinatura modular?" : "Salvar a assinatura?"}
        rodape={
          <>
            <Botao variante="secundaria" className="min-h-11" onClick={() => setRevisando(false)}>
              Voltar
            </Botao>
            <Botao className="min-h-11" disabled={!podeSalvar || ocupado} onClick={() => void salvar()}>
              Salvar assinatura
            </Botao>
          </>
        }
      >
        <div className="space-y-3 text-sm" data-testid="revisao-assinatura">
          <ul className="list-disc space-y-1 pl-5">
            {revisao.linhas.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {revisao.avisos.map((a) => (
            <p key={a} className="rounded-lg bg-paper-muted p-3">
              {a}
            </p>
          ))}
          {revisao.retirados.length > 0 && (
            <label className="flex min-h-11 items-start gap-3">
              <input type="checkbox" className="mt-1 size-5" checked={confirmaRetirada} onChange={(e) => setConfirmaRetirada(e.target.checked)} />
              <span>Confirmo a retirada de {revisao.retirados.join(", ")}.</span>
            </label>
          )}
          {exigeCiclo && (
            <label className="flex min-h-11 items-start gap-3">
              <input type="checkbox" className="mt-1 size-5" checked={confirmaCiclo} onChange={(e) => setConfirmaCiclo(e.target.checked)} />
              <span>Confirmo a troca do contrato trimestral para a assinatura mensal.</span>
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
