"use client";

// Recebimento INTEGRAL de uma venda: forma, data e observação. O valor é o
// total da venda confirmado pelo servidor; a tela não envia valor nenhum.
//
// Uma chave por formulário. Sem resposta (rede), o formulário trava e "Enviar
// de novo" repete a MESMA chave com os MESMOS dados: o servidor devolve o
// recebimento já gravado em vez de criar outro (lib/vendas/envio.ts). A
// venda nunca é afetada por uma falha aqui: ela já está gravada.
import { useRef, useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { acaoAdministrativa, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import { FORMAS_DE_PAGAMENTO, ROTULO_FORMA, type FormaDePagamento } from "@/lib/api/recebimentos-api";
import {
  caminhoReceberVenda,
  ehRecebimentoGravado,
  type CorpoDoRecebimento,
  type RecebimentoDeVenda,
} from "@/lib/api/vendas-api";
import { mensagemDaRecusa } from "@/lib/vendas/apresentacao";
import { concluirEnvio, formularioTravado, iniciarEnvio, novoEnvio, type EstadoDoEnvio } from "@/lib/vendas/envio";
import { formatarMoeda } from "@/lib/format";
import { dataCurta } from "@/lib/conta/inicio";
import { CLASSE_CAMPO } from "@/components/estoque/comum";

export function ReceberVenda({
  tenantId,
  venda,
  hoje,
  aoRegistrar,
  aoCancelar,
}: {
  tenantId: string;
  venda: { id: string; totalCents: number; localDate: string };
  /** Limite do campo de data (lib/vendas/apresentacao.ts). */
  hoje: string;
  aoRegistrar: (recebimento: RecebimentoDeVenda, criado: boolean) => void;
  aoCancelar?: () => void;
}) {
  const [envio, setEnvio] = useState<EstadoDoEnvio<CorpoDoRecebimento>>(() => novoEnvio(novaChaveDeFormulario()));
  const [forma, setForma] = useState<FormaDePagamento>("PIX");
  const [data, setData] = useState(hoje);
  const [observacao, setObservacao] = useState("");
  const emVoo = useRef(false);
  const travado = formularioTravado(envio);
  const problema = data === "" ? "Informe a data do recebimento." : data > hoje ? "A data não pode ser depois de hoje." : data < venda.localDate ? "A data não pode ser antes da venda." : null;

  async function enviar(evento?: FormEvent) {
    evento?.preventDefault();
    if (emVoo.current) return;
    const inicio = iniciarEnvio(envio, (chave) =>
      problema ? null : { requestKey: chave, method: forma, receivedOn: data, ...(observacao.trim() ? { notes: observacao.trim() } : {}) },
    );
    if (!inicio) return;
    emVoo.current = true;
    setEnvio(inicio.estado);
    const r = await acaoAdministrativa(caminhoReceberVenda(tenantId, venda.id), "POST", inicio.corpo);
    emVoo.current = false;
    if (r.tipo === "ok" && ehRecebimentoGravado(r.dados)) {
      aoRegistrar(r.dados.payment, r.dados.created);
      return;
    }
    if (r.tipo === "ok") {
      // Resposta fora do formato: o resultado é desconhecido.
      setEnvio(concluirEnvio(inicio.estado, { tipo: "rede" }));
      return;
    }
    setEnvio(concluirEnvio(inicio.estado, r));
  }

  return (
    <form onSubmit={(e) => void enviar(e)} className="space-y-3 rounded-lg border border-dashed border-border p-3" data-testid="receber-venda">
      <p className="text-sm text-ink">
        Valor a receber: <strong className="tabular-nums">{formatarMoeda(venda.totalCents)}</strong>{" "}
        <span className="text-ink-soft">(o total da venda; recebimento parcial não existe nesta versão).</span>
      </p>
      <fieldset disabled={travado} className="grid gap-3 sm:grid-cols-3">
        <label className="min-w-0 text-sm font-medium text-ink">
          Forma de pagamento
          <select className={`mt-1 min-h-11 ${CLASSE_CAMPO}`} value={forma} onChange={(e) => setForma(e.target.value as FormaDePagamento)} data-testid="forma-recebimento-venda">
            {FORMAS_DE_PAGAMENTO.map((f) => (
              <option key={f} value={f}>
                {ROTULO_FORMA[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium text-ink">
          Data do recebimento
          <input type="date" min={venda.localDate} max={hoje} className={`mt-1 min-h-11 ${CLASSE_CAMPO}`} value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <label className="min-w-0 text-sm font-medium text-ink sm:col-span-3">
          Observação (opcional)
          <input maxLength={300} className={`mt-1 min-h-11 ${CLASSE_CAMPO}`} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </label>
      </fieldset>
      <p className="text-xs text-ink-soft">Venda feita em {dataCurta(venda.localDate)}. A data do recebimento não pode ser antes dela nem depois de hoje.</p>
      {problema && !travado && (
        <p role="alert" className="text-sm text-ink">
          {problema}
        </p>
      )}
      {envio.fase === "recusado" && (
        <p role="alert" className="text-sm text-ink" data-testid="erro-receber-venda">
          {mensagemDaRecusa(envio.resultado)} A venda continua registrada.
        </p>
      )}
      {envio.fase === "incerto" && (
        <p role="alert" className="text-sm text-ink" data-testid="recebimento-incerto">
          Não foi possível confirmar o recebimento com o servidor. A venda continua registrada. Enviar de novo é seguro: são
          os mesmos dados, e o mesmo recebimento não é criado duas vezes.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Botao type="submit" className="min-h-11" disabled={envio.fase === "enviando" || (!travado && !!problema)} aria-busy={envio.fase === "enviando"} data-testid="confirmar-recebimento-venda">
          {envio.fase === "enviando" ? "Registrando..." : envio.fase === "incerto" ? "Enviar de novo" : `Receber ${formatarMoeda(venda.totalCents)}`}
        </Botao>
        {aoCancelar && (
          <Botao type="button" variante="fantasma" className="min-h-11" onClick={aoCancelar} disabled={envio.fase === "enviando"}>
            {envio.fase === "incerto" ? "Fechar sem confirmar" : "Agora não"}
          </Botao>
        )}
      </div>
    </form>
  );
}
