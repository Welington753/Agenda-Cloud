"use client";

// Nova movimentação manual: entrada por compra ou reposição, saída por
// venda, consumo interno ou perda. "Saída por venda" é só estoque (sem
// recebimento, comissão ou nota).
//
// Uma chave por formulário aberto. Se a rede cair, o envio fica "incerto":
// a pessoa confere o histórico ou repete com a MESMA chave (a API devolve o
// lançamento original, sem duplicar). Nada é reenviado sozinho.
import { useRef, useState } from "react";
import { novaChaveDeEnvio, registrarMovimentacao, type MovimentacaoEstoque, type ProdutoEstoque } from "@/lib/api/estoque-api";
import { formatarQuantidade, lerQuantidade } from "@/lib/estoque/quantidade";
import { motivoObrigatorio, ROTULO_TIPO, tiposPermitidos, type TipoManual } from "@/lib/estoque/rotulos";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { Botao } from "@/components/ui/button";
import { Campo, CLASSE_CAMPO, ErroDoFormulario } from "@/components/estoque/comum";

export function FormularioMovimentacao({
  tenantId,
  produtos,
  produtoInicial,
  aoRegistrar,
  aoCancelar,
}: {
  tenantId: string;
  produtos: ProdutoEstoque[];
  produtoInicial: string | null;
  aoRegistrar: (m: MovimentacaoEstoque) => void;
  aoCancelar: () => void;
}) {
  const chave = useRef(novaChaveDeEnvio());
  const travado = useRef(false);
  const [produtoId, setProdutoId] = useState(produtos.some((p) => p.id === produtoInicial) ? produtoInicial! : "");
  const [tipo, setTipo] = useState<TipoManual>("ENTRADA_COMPRA");
  const [quantidade, setQuantidade] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [incerto, setIncerto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const produto = produtos.find((p) => p.id === produtoId) ?? null;
  const tipos = produto ? tiposPermitidos(produto.purpose) : (["ENTRADA_COMPRA", "SAIDA_PERDA"] as TipoManual[]);
  const tipoValido = tipos.includes(tipo) ? tipo : tipos[0];

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (travado.current) return;
    const novos: Record<string, string> = {};
    if (!produto) novos.produto = "Escolha o produto.";
    const lido = produto ? lerQuantidade(quantidade, produto.unit) : null;
    if (lido && !lido.ok) novos.quantidade = lido.erro;
    if (motivoObrigatorio(tipoValido) && motivo.trim().length < 3) novos.motivo = "Informe o motivo (pelo menos 3 letras).";
    setErros(novos);
    if (Object.keys(novos).length || !produto || !lido?.ok) return;
    travado.current = true;
    setEnviando(true);
    setErro(null);
    try {
      const r = await registrarMovimentacao(tenantId, {
        requestKey: chave.current,
        productId: produto.id,
        kind: tipoValido,
        quantityMilli: lido.milli,
        expectedUnit: produto.unit,
        reason: motivo.trim() || null,
      });
      if (r.ok) {
        aoRegistrar(r.dados);
        return;
      }
      if (r.falha.tipo === "falha_comunicacao") {
        setIncerto(true);
        return;
      }
      setIncerto(false);
      // Recusa definitiva: os dados mudam, então a próxima tentativa é outra operação.
      chave.current = novaChaveDeEnvio();
      setErro(mensagemDaFalha(r.falha));
    } finally {
      travado.current = false;
      setEnviando(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void enviar(e)} noValidate>
      <Campo rotulo="Produto" htmlFor="mov-produto" erro={erros.produto}>
        <select id="mov-produto" className={CLASSE_CAMPO} value={produtoId} disabled={incerto} onChange={(e) => setProdutoId(e.target.value)}>
          <option value="">Escolha…</option>
          {produtos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({formatarQuantidade(p.balanceMilli, p.unit)})
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Tipo" htmlFor="mov-tipo">
        <select id="mov-tipo" className={CLASSE_CAMPO} value={tipoValido} disabled={incerto} onChange={(e) => setTipo(e.target.value as TipoManual)}>
          {tipos.map((t) => (
            <option key={t} value={t}>
              {ROTULO_TIPO[t]}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo={produto ? `Quantidade (${produto.unit})` : "Quantidade"} htmlFor="mov-quantidade" erro={erros.quantidade}>
        <input id="mov-quantidade" className={CLASSE_CAMPO} inputMode="decimal" value={quantidade} disabled={incerto} onChange={(e) => setQuantidade(e.target.value)} />
      </Campo>
      <Campo rotulo={motivoObrigatorio(tipoValido) ? "Motivo" : "Observação (opcional)"} htmlFor="mov-motivo" erro={erros.motivo}>
        <input id="mov-motivo" className={CLASSE_CAMPO} maxLength={300} value={motivo} disabled={incerto} onChange={(e) => setMotivo(e.target.value)} />
      </Campo>
      {incerto && (
        <p className="rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-sm text-ink" role="status">
          Não deu para confirmar se a movimentação chegou. Repetir este envio é seguro: se ela já foi registrada, não será duplicada.
        </p>
      )}
      <ErroDoFormulario mensagem={erro} />
      <div className="flex flex-wrap justify-end gap-2">
        <Botao type="button" variante="fantasma" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
        <Botao type="submit" disabled={enviando}>
          {enviando ? "Registrando…" : incerto ? "Repetir envio" : "Registrar"}
        </Botao>
      </div>
    </form>
  );
}
