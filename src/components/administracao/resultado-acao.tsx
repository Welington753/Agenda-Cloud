"use client";

// Resultado de uma ação da ficha do estabelecimento: ocupado enquanto envia,
// a mensagem do servidor (ou de sucesso) e a releitura depois do sucesso.
import { useState } from "react";
import { mensagemDoResultado, type ResultadoAcao } from "@/lib/administracao/api-contas";
import { useToast } from "@/components/ui/toast";

export function useResultado(aoMudar: () => void) {
  const [mensagem, setMensagem] = useState<{ texto: string; ok: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { notificar } = useToast();
  async function executar(acao: () => Promise<ResultadoAcao<unknown>>, sucesso: string) {
    if (ocupado) return false;
    setOcupado(true);
    setMensagem(null);
    const r = await acao();
    setOcupado(false);
    if (r.tipo === "ok") {
      // O bloco é remontado com a versão nova: o sucesso vai para o aviso.
      notificar(sucesso, "sucesso");
      aoMudar();
      return true;
    }
    setMensagem({ texto: mensagemDoResultado(r), ok: false });
    return false;
  }
  return { mensagem, ocupado, executar };
}

export function Retorno({ mensagem }: { mensagem: { texto: string; ok: boolean } | null }) {
  if (!mensagem) return null;
  return (
    <p role={mensagem.ok ? "status" : "alert"} className="text-sm text-ink-soft" data-testid="retorno-estabelecimento">
      {mensagem.texto}
    </p>
  );
}
