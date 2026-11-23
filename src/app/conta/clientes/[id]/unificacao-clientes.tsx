"use client";

// Unificação de dois cadastros (só o dono), em três passos:
// 1. escolher qual cadastro fica com o histórico (o principal);
// 2. revisar a prévia: o que vai para o principal e o que não muda;
// 3. confirmar.
// Cancelar, em qualquer passo, não grava nada. Se os dados mudaram desde a
// prévia (409 `PREVIA_DESATUALIZADA`), nada foi transferido e a tela volta à
// revisão com a prévia nova. Sem resposta: a pessoa recarrega a ficha;
// repetir a mesma unificação é seguro (o servidor devolve o que já gravou).
import { useState } from "react";
import { Botao } from "@/components/ui/button";
import {
  lerPreviaDaUnificacao,
  unificarClientes,
  type ClienteReal,
  type FalhaClientesReal,
  type PreviaDaUnificacao,
  type ResultadoDaUnificacao,
} from "@/lib/api/consumers-api";
import { O_QUE_NAO_MUDA, ROTULO_RELACAO, linhasDaTransferencia, mensagemFalhaUnificacao } from "@/lib/clientes/ficha";

interface UnificacaoClientesProps {
  tenantId: string;
  esteCadastro: ClienteReal;
  outroCadastro: ClienteReal;
  aoConcluir: (resultado: ResultadoDaUnificacao) => void;
  aoCancelar: () => void;
}

type Passo =
  | { passo: "escolher" }
  | { passo: "carregando" }
  | { passo: "revisar"; previa: PreviaDaUnificacao; aviso: string | null }
  | { passo: "confirmando"; previa: PreviaDaUnificacao };

export function UnificacaoClientes({ tenantId, esteCadastro, outroCadastro, aoConcluir, aoCancelar }: UnificacaoClientesProps) {
  const [principalId, setPrincipalId] = useState(esteCadastro.id);
  const [estado, setEstado] = useState<Passo>({ passo: "escolher" });
  const [falha, setFalha] = useState<FalhaClientesReal | null>(null);
  const secundarioId = principalId === esteCadastro.id ? outroCadastro.id : esteCadastro.id;

  async function revisar() {
    setFalha(null);
    setEstado({ passo: "carregando" });
    const resultado = await lerPreviaDaUnificacao(tenantId, secundarioId, principalId);
    if (resultado.ok) setEstado({ passo: "revisar", previa: resultado.dados, aviso: null });
    else {
      setFalha(resultado.falha);
      setEstado({ passo: "escolher" });
    }
  }

  async function confirmar(previa: PreviaDaUnificacao) {
    setFalha(null);
    setEstado({ passo: "confirmando", previa });
    const resultado = await unificarClientes(tenantId, previa.secundario.id, {
      principalId: previa.principal.id,
      versaoDaPrevia: previa.versaoDaPrevia,
    });
    if (resultado.ok) {
      aoConcluir(resultado.dados);
      return;
    }
    if (resultado.falha.tipo === "previa_desatualizada" && resultado.falha.previa) {
      setEstado({ passo: "revisar", previa: resultado.falha.previa, aviso: mensagemFalhaUnificacao(resultado.falha) });
      return;
    }
    setFalha(resultado.falha);
    setEstado({ passo: "revisar", previa, aviso: null });
  }

  const opcao = (cliente: ClienteReal) => (
    <label key={cliente.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border p-3">
      <input
        type="radio"
        name="principal"
        value={cliente.id}
        checked={principalId === cliente.id}
        onChange={() => setPrincipalId(cliente.id)}
        className="mt-1"
      />
      <span className="min-w-0 text-sm">
        <span className="block font-semibold break-words text-ink">{cliente.name}</span>
        <span className="block text-ink-soft">{cliente.whatsapp}</span>
        {cliente.email && <span className="block break-all text-ink-soft">{cliente.email}</span>}
      </span>
    </label>
  );

  return (
    <section aria-labelledby="titulo-unificar" className="space-y-4" data-testid="unificar-cadastros">
      <h2 id="titulo-unificar" className="text-base font-semibold text-ink">
        Unificar cadastros
      </h2>

      {(estado.passo === "escolher" || estado.passo === "carregando") && (
        <fieldset className="space-y-3" disabled={estado.passo === "carregando"}>
          <legend className="text-sm text-ink">
            <span className="font-medium">Passo 1 de 3.</span> Qual cadastro fica com o histórico? O outro deixa de aparecer na lista,
            sem ser apagado.
          </legend>
          {opcao(esteCadastro)}
          {opcao(outroCadastro)}
          <div className="flex flex-wrap gap-2">
            <Botao type="button" onClick={() => void revisar()} aria-busy={estado.passo === "carregando"} data-testid="unificar-revisar">
              {estado.passo === "carregando" ? "Preparando a prévia..." : "Revisar a prévia"}
            </Botao>
            <Botao type="button" variante="secundaria" onClick={aoCancelar}>
              Cancelar
            </Botao>
          </div>
        </fieldset>
      )}

      {(estado.passo === "revisar" || estado.passo === "confirmando") && (
        <div className="space-y-4" data-testid="unificar-previa">
          <p className="text-sm text-ink">
            <span className="font-medium">Passo 2 de 3.</span> Confira antes de confirmar.
          </p>
          {estado.passo === "revisar" && estado.aviso && (
            <p role="alert" className="text-sm text-[color:var(--color-danger)]" data-testid="unificar-previa-desatualizada">
              {estado.aviso}
            </p>
          )}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-soft">Fica com o histórico (principal)</dt>
              <dd className="font-semibold break-words text-ink">
                {estado.previa.principal.name} · {estado.previa.principal.whatsapp}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">Deixa de aparecer na lista</dt>
              <dd className="font-semibold break-words text-ink">
                {estado.previa.secundario.name} · {estado.previa.secundario.whatsapp}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-ink-soft">Sugestão: {estado.previa.relacoes.map((r) => ROTULO_RELACAO[r]).join(", ")}.</p>
          <div>
            <p className="text-sm font-medium text-ink">Vai para o cadastro principal:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink" data-testid="unificar-transferir">
              {linhasDaTransferencia(estado.previa.transferir).map((linha) => (
                <li key={linha}>{linha}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium text-ink">Não muda:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">
              {O_QUE_NAO_MUDA.map((linha) => (
                <li key={linha}>{linha}</li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-ink">
            <span className="font-medium">Passo 3 de 3.</span> A unificação não é desfeita pela tela.
          </p>
          <div className="flex flex-wrap gap-2">
            <Botao
              type="button"
              variante="perigo"
              disabled={estado.passo === "confirmando"}
              aria-busy={estado.passo === "confirmando"}
              onClick={() => void confirmar(estado.previa)}
              data-testid="unificar-confirmar"
            >
              {estado.passo === "confirmando" ? "Unificando..." : "Confirmar unificação"}
            </Botao>
            <Botao type="button" variante="secundaria" disabled={estado.passo === "confirmando"} onClick={aoCancelar} data-testid="unificar-cancelar">
              Cancelar
            </Botao>
          </div>
        </div>
      )}

      {falha && (
        <p role="alert" className="text-sm text-[color:var(--color-danger)]" data-testid="unificar-falha">
          {mensagemFalhaUnificacao(falha)}
        </p>
      )}
    </section>
  );
}
