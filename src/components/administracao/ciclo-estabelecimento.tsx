"use client";

// Escritas da administração sobre UM estabelecimento: dados cadastrais e
// situação (suspender, reativar, arquivar). O plano fica em
// plano-estabelecimento.tsx. Cada botão só aparece
// quando o servidor disse que esta conta pode usá-lo (`allowedActions`), e o
// servidor confere de novo em cada operação.
//
// Situação e plano pedem a senha (mesma reautenticação das contas). Todas as
// ações mandam a versão lida (`updatedAt`): outra tela mudou antes, 409 e
// nada é gravado. O endereço público (slug) nunca muda por aqui.
import { useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useAcaoSensivel } from "./reautenticacao";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import { SEGMENTOS, SITUACOES, type DetalheEstabelecimento } from "@/lib/administracao/contratos";
import { Retorno, useResultado } from "./resultado-acao";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

// ------------------------------------------------------------ dados cadastrais

export function DadosCadastrais({ item, aoMudar }: { item: DetalheEstabelecimento; aoMudar: () => void }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(item.name);
  const [segmento, setSegmento] = useState(item.category);
  const [documento, setDocumento] = useState(item.taxDocument ?? "");
  const { mensagem, ocupado, executar } = useResultado(aoMudar);

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    void executar(
      () =>
        acaoAdministrativa(`/platform/establishments/${encodeURIComponent(item.id)}`, "PATCH", {
          expectedUpdatedAt: item.updatedAt,
          name: nome,
          category: segmento,
          taxDocument: documento.trim() ? documento : null,
        }),
      "Dados salvos. O endereço público continua o mesmo.",
    ).then((ok) => ok && setEditando(false));
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Dados cadastrais</h2>
          {item.allowedActions.edit && !editando && (
            <Botao variante="secundaria" className="min-h-11" onClick={() => setEditando(true)}>
              Editar dados
            </Botao>
          )}
        </div>
        {!editando ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-ink-soft">Nome</dt>
              <dd className="mt-1 break-words text-sm font-medium">{item.name}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-ink-soft">Segmento</dt>
              <dd className="mt-1 text-sm font-medium">{SEGMENTOS[item.category] ?? item.category}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-ink-soft">CPF ou CNPJ</dt>
              <dd className="mt-1 break-all text-sm font-medium">{item.taxDocument ?? "Não informado"}</dd>
            </div>
          </dl>
        ) : (
          <form onSubmit={aoEnviar} className="space-y-3" data-testid="editar-estabelecimento">
            <fieldset disabled={ocupado} className="grid gap-3 sm:grid-cols-3">
              <label className="min-w-0 text-sm font-medium">
                Nome
                <input required minLength={2} maxLength={120} className={CAMPO} value={nome} onChange={(e) => setNome(e.target.value)} />
              </label>
              <label className="min-w-0 text-sm font-medium">
                Segmento
                <select className={CAMPO} value={segmento} onChange={(e) => setSegmento(e.target.value)}>
                  {Object.entries(SEGMENTOS).map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>
                      {rotulo}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 text-sm font-medium">
                CPF ou CNPJ (opcional)
                <input
                  inputMode="numeric"
                  maxLength={18}
                  className={CAMPO}
                  value={documento}
                  onChange={(e) => setDocumento(e.target.value)}
                />
              </label>
            </fieldset>
            <p className="text-xs text-ink-soft">
              O endereço público (<span className="break-all">{item.slug}</span>) não muda aqui: links já enviados aos
              clientes continuam funcionando.
            </p>
            <div className="flex flex-wrap gap-2">
              <Botao type="submit" disabled={ocupado} className="min-h-11">
                Salvar dados
              </Botao>
              <Botao type="button" variante="fantasma" className="min-h-11" onClick={() => setEditando(false)}>
                Cancelar
              </Botao>
            </div>
          </form>
        )}
        <Retorno mensagem={mensagem} />
      </CartaoCorpo>
    </Cartao>
  );
}

// ------------------------------------------------------------------ situação

type AcaoDeSituacao = "suspend" | "archive" | "reactivate";

const TEXTO_SITUACAO: Record<AcaoDeSituacao, { titulo: string; botao: string; efeito: ReactNode }> = {
  suspend: {
    titulo: "Suspender o estabelecimento?",
    botao: "Suspender",
    efeito: (
      <>
        <p>
          A equipe deixa de usar este estabelecimento (agenda, clientes, configurações) e o agendamento público para de
          receber pedidos. Os avisos de novas solicitações param.
        </p>
        <p>
          Nada é apagado: agenda, reservas, clientes, vínculos e histórico ficam. As pessoas continuam entrando nos outros
          estabelecimentos a que têm acesso. Dá para reativar depois.
        </p>
      </>
    ),
  },
  archive: {
    titulo: "Arquivar o estabelecimento?",
    botao: "Arquivar",
    efeito: (
      <>
        <p>
          Arquivar é encerrar sem apagar: o estabelecimento sai de operação como na suspensão (equipe e agendamento
          público param), e fica marcado como arquivado.
        </p>
        <p>
          Agenda, reservas, clientes, vínculos e histórico ficam guardados. As contas das pessoas não são apagadas. A
          administração pode reativar depois.
        </p>
      </>
    ),
  },
  reactivate: {
    titulo: "Reativar o estabelecimento?",
    botao: "Reativar",
    efeito: (
      <p>
        O estabelecimento volta à situação anterior à restrição, com a equipe, a agenda e o agendamento público como
        estavam (o agendamento público só volta se estava ligado).
      </p>
    ),
  },
};

export function SituacaoDoEstabelecimento({ item, aoMudar }: { item: DetalheEstabelecimento; aoMudar: () => void }) {
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(aoMudar);
  const [pergunta, setPergunta] = useState<AcaoDeSituacao | null>(null);
  const [motivo, setMotivo] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const acoes = item.allowedActions;
  if (!acoes.suspend && !acoes.archive && !acoes.reactivate && item.status !== "SUSPENDED" && item.status !== "ARCHIVED") {
    return null;
  }

  function abrir(acao: AcaoDeSituacao) {
    setMotivo("");
    setConfirmacao("");
    setPergunta(acao);
  }

  async function confirmar() {
    if (!pergunta) return;
    const corpo: Record<string, string> = { expectedUpdatedAt: item.updatedAt };
    if (pergunta !== "reactivate") corpo.reason = motivo;
    if (pergunta === "archive") corpo.confirmSlug = confirmacao;
    const acao = pergunta;
    setPergunta(null);
    await executar(
      () => executarSensivel(() => acaoAdministrativa(`/platform/establishments/${encodeURIComponent(item.id)}/${acao}`, "POST", corpo)),
      acao === "suspend" ? "Estabelecimento suspenso." : acao === "archive" ? "Estabelecimento arquivado." : "Estabelecimento reativado.",
    );
  }

  const precisaMotivo = pergunta === "suspend" || pergunta === "archive";
  const podeConfirmar =
    !!pergunta &&
    (!precisaMotivo || motivo.trim().length >= 3) &&
    (pergunta !== "archive" || confirmacao.trim().toLowerCase() === item.slug.toLowerCase());

  return (
    <Cartao>
      <CartaoCorpo className="space-y-3" data-testid="situacao-estabelecimento">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Situação</h2>
          <Badge cor={item.status === "SUSPENDED" || item.status === "ARCHIVED" ? "aviso" : "sucesso"}>
            {SITUACOES[item.status]}
          </Badge>
        </div>
        {item.suspensionReason && (item.status === "SUSPENDED" || item.status === "ARCHIVED") && (
          <p className="break-words text-sm text-ink-soft">Motivo registrado: {item.suspensionReason}</p>
        )}
        {(item.status === "SUSPENDED" || item.status === "ARCHIVED") && item.restoreStatus && (
          <p className="text-xs text-ink-soft">
            Ao reativar, volta para: {SITUACOES[item.restoreStatus as keyof typeof SITUACOES] ?? item.restoreStatus}.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {acoes.suspend && (
            <Botao variante="secundaria" className="min-h-11" onClick={() => abrir("suspend")}>
              Suspender
            </Botao>
          )}
          {acoes.reactivate && (
            <Botao className="min-h-11" onClick={() => abrir("reactivate")}>
              Reativar
            </Botao>
          )}
          {acoes.archive && (
            <Botao variante="perigo" className="min-h-11" onClick={() => abrir("archive")}>
              Arquivar
            </Botao>
          )}
        </div>
        {!acoes.suspend && !acoes.archive && !acoes.reactivate && (
          <p className="text-xs text-ink-soft">Só a pessoa responsável pela plataforma muda a situação de um estabelecimento.</p>
        )}
        <Retorno mensagem={mensagem} />
        <Modal
          aberto={pergunta !== null}
          aoFechar={() => setPergunta(null)}
          titulo={pergunta ? TEXTO_SITUACAO[pergunta].titulo : ""}
          rodape={
            <>
              <Botao variante="secundaria" className="min-h-11" onClick={() => setPergunta(null)}>
                Cancelar
              </Botao>
              <Botao
                variante={pergunta === "archive" ? "perigo" : "primaria"}
                className="min-h-11"
                disabled={!podeConfirmar || ocupado}
                onClick={() => void confirmar()}
              >
                {pergunta ? TEXTO_SITUACAO[pergunta].botao : ""}
              </Botao>
            </>
          }
        >
          {pergunta && (
            <div className="space-y-3">
              {TEXTO_SITUACAO[pergunta].efeito}
              {precisaMotivo && (
                <label className="block text-sm font-medium">
                  Motivo (fica no histórico)
                  <textarea
                    required
                    minLength={3}
                    maxLength={300}
                    rows={2}
                    className={`${CAMPO} py-2`}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                </label>
              )}
              {pergunta === "archive" && (
                <label className="block text-sm font-medium">
                  Para confirmar, digite o endereço: <span className="break-all font-mono">{item.slug}</span>
                  <input className={CAMPO} value={confirmacao} autoComplete="off" onChange={(e) => setConfirmacao(e.target.value)} />
                </label>
              )}
            </div>
          )}
        </Modal>
      </CartaoCorpo>
    </Cartao>
  );
}
