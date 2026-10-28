"use client";

// Peças comuns das seções da ficha de usuário: o retorno de cada ação (com
// a mensagem real do servidor) e a confirmação antes de mudanças sensíveis.
import { useState, type ReactNode } from "react";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { useToast } from "@/components/ui/toast";
import { mensagemDoResultado, type ResultadoAcao } from "@/lib/administracao/api-contas";
import type { FichaUsuario } from "@/lib/administracao/contas";

export interface SecaoProps {
  ficha: FichaUsuario;
  aoMudar: () => void;
}

export const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

export type Mensagem = { texto: string; erro: boolean } | null;

/** Executa uma ação (pedindo a senha se o servidor exigir) e guarda a
 * mensagem do resultado para a seção mostrar. Conflito recarrega a ficha:
 * outra tela mudou, e a pessoa precisa ver o estado atual. */
export function useExecucao(aoMudar: () => void) {
  const executarSensivel = useAcaoSensivel();
  const { notificar } = useToast();
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  async function executar<T>(acao: () => Promise<ResultadoAcao<T>>, sucesso: string): Promise<boolean> {
    if (ocupado) return false;
    setOcupado(true);
    setMensagem(null);
    const r = await executarSensivel(acao);
    setOcupado(false);
    if (r.tipo === "ok") {
      setMensagem({ texto: sucesso, erro: false });
      // Também em aviso: a seção pode sumir ao recarregar (ex.: desvínculo).
      notificar(sucesso, "sucesso");
      aoMudar();
      return true;
    }
    setMensagem({ texto: mensagemDoResultado(r), erro: true });
    if (r.tipo === "conflito") aoMudar();
    return false;
  }
  return { executar, ocupado, mensagem };
}

export function Retorno({ mensagem }: { mensagem: Mensagem }) {
  if (!mensagem) return null;
  return (
    <p role={mensagem.erro ? "alert" : "status"} className={mensagem.erro ? "text-sm text-danger" : "text-sm text-ink-soft"}>
      {mensagem.texto}
    </p>
  );
}

/** Botão que pede confirmação explícita antes de agir. */
export function BotaoConfirmado({
  rotulo,
  titulo,
  texto,
  confirmar,
  perigo = false,
  disabled,
  aoConfirmar,
}: {
  rotulo: string;
  titulo: string;
  texto: ReactNode;
  confirmar: string;
  perigo?: boolean;
  disabled?: boolean;
  aoConfirmar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Botao variante={perigo ? "perigo" : "secundaria"} className="min-h-11" disabled={disabled} onClick={() => setAberto(true)}>
        {rotulo}
      </Botao>
      <Modal
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        titulo={titulo}
        rodape={
          <>
            <Botao variante="secundaria" className="min-h-11" onClick={() => setAberto(false)}>
              Cancelar
            </Botao>
            <Botao
              variante={perigo ? "perigo" : "primaria"}
              className="min-h-11"
              onClick={() => {
                setAberto(false);
                aoConfirmar();
              }}
            >
              {confirmar}
            </Botao>
          </>
        }
      >
        {texto}
      </Modal>
    </>
  );
}
