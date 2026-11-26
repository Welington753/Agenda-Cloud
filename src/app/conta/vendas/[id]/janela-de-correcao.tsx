"use client";

// Estorno do recebimento ou cancelamento da venda: motivo (3 a 300
// caracteres) e a senha confirmada há pouco (useAcaoSensivel pede quando o
// servidor exige). Repetir com o MESMO motivo devolve o registro já gravado,
// sem novo lançamento; por isso, sem resposta, o motivo fica travado.
import { useState } from "react";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { CLASSE_CAMPO } from "@/components/estoque/comum";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { acaoAdministrativa, type ResultadoAcao } from "@/lib/administracao/api-contas";
import { caminhoCancelarVenda, caminhoEstornarRecebimento, ehRecebimentoGravado, ehVendaGravada, type Venda } from "@/lib/api/vendas-api";
import { formatarMoeda } from "@/lib/format";
import { mensagemDaRecusa } from "@/lib/vendas/apresentacao";

export function JanelaDeCorrecao({
  operacao,
  tenantId,
  venda,
  paymentId,
  aoFechar,
  aoConcluir,
}: {
  operacao: "cancelar" | "estornar";
  tenantId: string;
  venda: Venda;
  paymentId: string | null;
  aoFechar: () => void;
  aoConcluir: (mensagem: string) => void;
}) {
  const executarSensivel = useAcaoSensivel();
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<Exclude<ResultadoAcao<unknown>, { tipo: "ok" }> | null>(null);
  // Sem resposta, o motivo fica como foi enviado: repetir com o mesmo motivo
  // devolve o registro já gravado, sem novo lançamento.
  const incerto = falha?.tipo === "rede";
  const valido = motivo.trim().length >= 3;

  async function confirmar() {
    if (ocupado || !valido) return;
    setOcupado(true);
    setFalha(null);
    const r = await executarSensivel(() =>
      operacao === "cancelar"
        ? acaoAdministrativa(caminhoCancelarVenda(tenantId, venda.id), "POST", { reason: motivo.trim() })
        : acaoAdministrativa(caminhoEstornarRecebimento(tenantId, paymentId ?? ""), "POST", { reason: motivo.trim() }),
    );
    setOcupado(false);
    if (r.tipo === "ok" && (operacao === "cancelar" ? ehVendaGravada(r.dados) : ehRecebimentoGravado(r.dados))) {
      const criado = (r.dados as { created: boolean }).created;
      aoConcluir(
        operacao === "cancelar"
          ? criado
            ? "Venda cancelada. As quantidades voltaram ao estoque."
            : "Esta venda já estava cancelada com este motivo."
          : criado
            ? "Recebimento estornado. O registro original continua no histórico."
            : "Este recebimento já estava estornado com este motivo.",
      );
      return;
    }
    setFalha(r.tipo === "ok" ? { tipo: "rede" } : r);
  }

  const titulo = operacao === "cancelar" ? "Cancelar a venda?" : "Estornar o recebimento?";
  return (
    <Modal
      aberto
      aoFechar={() => !ocupado && aoFechar()}
      titulo={titulo}
      rodape={
        <>
          <Botao variante="secundaria" className="min-h-11" onClick={aoFechar} disabled={ocupado}>
            Voltar
          </Botao>
          <Botao variante="perigo" className="min-h-11" onClick={() => void confirmar()} disabled={ocupado || !valido} data-testid="confirmar-correcao">
            {ocupado ? "Enviando..." : incerto ? "Repetir com o mesmo motivo" : operacao === "cancelar" ? "Cancelar venda" : "Estornar"}
          </Botao>
        </>
      }
    >
      <div className="space-y-3">
        <p>
          {operacao === "cancelar"
            ? `A venda de ${formatarMoeda(venda.totalCents)} fica cancelada e as quantidades voltam ao estoque. O registro não é apagado.`
            : `O estorno é do valor inteiro e entra no período de hoje. A venda continua ativa e volta a aguardar recebimento.`}
        </p>
        <label className="block text-sm font-medium">
          Motivo (pelo menos 3 letras)
          <input
            className={`mt-1 min-h-11 ${CLASSE_CAMPO}`}
            maxLength={300}
            value={motivo}
            readOnly={incerto}
            onChange={(e) => setMotivo(e.target.value)}
            data-testid="motivo-correcao"
          />
        </label>
        {falha && (
          <p role="alert" className="text-sm" data-testid="erro-correcao">
            {incerto
              ? "Não foi possível confirmar com o servidor. Repetir com o mesmo motivo é seguro: se já foi feito, o servidor devolve o mesmo registro."
              : mensagemDaRecusa(falha)}
          </p>
        )}
      </div>
    </Modal>
  );
}
