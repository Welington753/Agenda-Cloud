"use client";

// Contexto de sessão REAL (Lote 6C.1) — completamente separado de
// `auth-context.tsx` (sessão simulada da demonstração). Nunca compartilha
// estado, storage ou provider com a demo: uma conta real e uma sessão de
// demonstração podem, inclusive, existir ao mesmo tempo em abas diferentes
// sem se misturarem, porque vivem em namespaces de storage diferentes
// (cookie HttpOnly aqui vs. sessionStorage lá) e em Contexts React distintos.
//
// Este provider só ORQUESTRA efeitos (chamar a API, guardar preferência de
// tenant) em torno da lógica pura de `real-session-state.ts` — a decisão de
// qual estado resulta de cada resposta vive lá, não aqui.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as authApi from "@/lib/api/auth-api";
import type { ResultadoAutenticacaoReal, SessaoRealContexto } from "@/lib/api/auth-api";
import {
  podeAplicarResultado,
  reduzirResultadoSessao,
  selecionarTenant,
  type EstadoAutenticacaoReal,
} from "./real-session-state";
import { lerPreferenciaTenant, salvarPreferenciaTenant } from "./tenant-preference";

export interface ResultadoLogout {
  /** `true` só quando o backend confirmou a revogação (204). `false` numa
   * falha de comunicação — a UI nunca deve afirmar "sessão encerrada no
   * servidor" nesse caso, só "você saiu neste dispositivo". */
  confirmadoPeloServidor: boolean;
}

interface RealAuthContextValue {
  estado: EstadoAutenticacaoReal;
  login: (email: string, senha: string) => Promise<ResultadoAutenticacaoReal<SessaoRealContexto>>;
  logout: () => Promise<ResultadoLogout>;
  recarregar: () => void;
  selecionarTenantAtivo: (tenantId: string) => boolean;
}

const RealAuthContext = createContext<RealAuthContextValue | undefined>(undefined);

export function RealAuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoAutenticacaoReal>({ status: "carregando" });
  // Incrementada a cada ação que decide autoritativamente o novo estado
  // (login, logout, recarregar) — uma resposta assíncrona só pode aplicar seu
  // resultado se a geração não mudou enquanto ela estava em voo (ver
  // `podeAplicarResultado`). É isto que impede uma resposta atrasada de
  // /auth/me restaurar a sessão depois de um logout.
  const geracaoRef = useRef(0);

  const carregarSessao = useCallback(async () => {
    const geracaoDaChamada = geracaoRef.current;
    const resultado = await authApi.buscarSessaoAtual();
    if (!podeAplicarResultado(geracaoRef.current, geracaoDaChamada)) return;
    setEstado(reduzirResultadoSessao(resultado, lerPreferenciaTenant()));
  }, []);

  useEffect(() => {
    void carregarSessao();
  }, [carregarSessao]);

  const login = useCallback(async (email: string, senha: string) => {
    geracaoRef.current += 1;
    const geracaoDaChamada = geracaoRef.current;
    const resultado = await authApi.login(email, senha);
    if (podeAplicarResultado(geracaoRef.current, geracaoDaChamada) && resultado.ok) {
      setEstado(reduzirResultadoSessao({ ok: true, dados: resultado.dados }, lerPreferenciaTenant()));
    }
    return resultado;
  }, []);

  const logout = useCallback(async (): Promise<ResultadoLogout> => {
    // Sai imediatamente na UI (otimista) — nunca deixa a tela autenticada
    // visível enquanto espera a rede; a geração muda ANTES do await, então
    // nenhuma resposta de /auth/me já em voo consegue mais escrever estado.
    geracaoRef.current += 1;
    salvarPreferenciaTenant(null);
    setEstado({ status: "nao_autenticado" });

    const resultado = await authApi.logout();
    return { confirmadoPeloServidor: resultado.ok };
  }, []);

  const recarregar = useCallback(() => {
    void carregarSessao();
  }, [carregarSessao]);

  const selecionarTenantAtivo = useCallback((tenantId: string): boolean => {
    let aceito = false;
    setEstado((atual) => {
      const proximo = selecionarTenant(atual, tenantId);
      aceito = proximo !== atual;
      return proximo;
    });
    if (aceito) salvarPreferenciaTenant(tenantId);
    return aceito;
  }, []);

  return (
    <RealAuthContext.Provider value={{ estado, login, logout, recarregar, selecionarTenantAtivo }}>
      {children}
    </RealAuthContext.Provider>
  );
}

export function useRealAuth(): RealAuthContextValue {
  const contexto = useContext(RealAuthContext);
  if (!contexto) throw new Error("useRealAuth precisa ser usado dentro de <RealAuthProvider>");
  return contexto;
}
