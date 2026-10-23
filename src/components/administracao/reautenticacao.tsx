"use client";

// Confirmação de senha para mudanças sensíveis. A tela chama
// `executar(acao)`; se o servidor responder que precisa da senha de novo,
// abre o diálogo, confirma (`POST /platform/reauth`) e repete a MESMA ação
// uma vez. Cancelar devolve o resultado "reautenticar" a quem chamou, sem
// gravar nada. A senha só vai para a confirmação, nunca para a ação.
import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "@/components/ui/modal";
import { Botao } from "@/components/ui/button";
import { confirmarSenha, type ResultadoAcao } from "@/lib/administracao/api-contas";

type Executar = <T>(acao: () => Promise<ResultadoAcao<T>>) => Promise<ResultadoAcao<T>>;

const Contexto = createContext<Executar | null>(null);

const MENSAGEM: Record<string, string> = {
  "senha-incorreta": "Senha incorreta.",
  limite: "Muitas tentativas. Aguarde alguns minutos.",
  rede: "Não foi possível falar com o servidor. Tente de novo.",
  erro: "Não foi possível confirmar agora.",
};

export function ReautenticacaoProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const pendente = useRef<((confirmado: boolean) => void) | null>(null);

  const pedirSenha = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        pendente.current = resolve;
        setSenha("");
        setErro("");
        setAberto(true);
      }),
    [],
  );

  const fechar = useCallback((confirmado: boolean) => {
    setAberto(false);
    setSenha("");
    pendente.current?.(confirmado);
    pendente.current = null;
  }, []);

  const executar = useCallback<Executar>(
    async (acao) => {
      const primeira = await acao();
      if (primeira.tipo !== "reautenticar") return primeira;
      if (!(await pedirSenha())) return primeira;
      return acao();
    },
    [pedirSenha],
  );

  async function aoConfirmar(evento: FormEvent) {
    evento.preventDefault();
    if (confirmando) return;
    setConfirmando(true);
    const resultado = await confirmarSenha(senha);
    setConfirmando(false);
    if (resultado === "ok") fechar(true);
    else setErro(MENSAGEM[resultado]);
  }

  return (
    <Contexto.Provider value={executar}>
      {children}
      <Modal aberto={aberto} aoFechar={() => fechar(false)} titulo="Confirme sua senha">
        <form onSubmit={(e) => void aoConfirmar(e)} className="space-y-3" data-testid="confirmar-senha">
          <p>Esta mudança é sensível. Digite a senha da sua conta para continuar.</p>
          <label className="block text-sm font-medium text-ink">
            Sua senha
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={10}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
            />
          </label>
          {erro && (
            <p role="alert" className="text-sm text-danger">
              {erro}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="secundaria" onClick={() => fechar(false)} className="min-h-11">
              Cancelar
            </Botao>
            <Botao type="submit" disabled={confirmando} className="min-h-11">
              {confirmando ? "Confirmando…" : "Confirmar"}
            </Botao>
          </div>
        </form>
      </Modal>
    </Contexto.Provider>
  );
}

export function useAcaoSensivel(): Executar {
  const executar = useContext(Contexto);
  if (!executar) throw new Error("useAcaoSensivel fora de ReautenticacaoProvider");
  return executar;
}
