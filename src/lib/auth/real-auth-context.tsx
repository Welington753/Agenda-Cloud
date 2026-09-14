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
import type { DadosCadastroReal, ResultadoAutenticacaoReal, SessaoRealContexto } from "@/lib/api/auth-api";
import { decidirFluxoCadastro, type ResultadoFluxoCadastro } from "./cadastro-fluxo";
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
  /** POST /auth/register e, só se ele confirmar, restauração do contexto por
   * /auth/me. Nunca reenvia o cadastro por conta própria. */
  cadastrar: (dados: DadosCadastroReal) => Promise<ResultadoFluxoCadastro>;
  /** Repete SÓ o /auth/me — recuperação do estado `sessao_pendente` sem
   * reenviar POST /auth/register. */
  restaurarSessao: () => Promise<ResultadoFluxoCadastro>;
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

  // Devolve o estado efetivamente aplicado, ou `null` quando a resposta
  // chegou tarde demais (geração mudou) e foi descartada — quem chamou
  // precisa saber a diferença entre "sessão restaurada" e "não deu".
  const carregarSessao = useCallback(async (): Promise<EstadoAutenticacaoReal | null> => {
    const geracaoDaChamada = geracaoRef.current;
    const resultado = await authApi.buscarSessaoAtual();
    if (!podeAplicarResultado(geracaoRef.current, geracaoDaChamada)) return null;
    const proximo = reduzirResultadoSessao(resultado, lerPreferenciaTenant());
    setEstado(proximo);
    return proximo;
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

  // `cadastrar` nunca repete o POST sozinho: uma única tentativa por chamada.
  // Se o register confirmar (201) mas o /auth/me falhar, o resultado é
  // `sessao_pendente` — a conta JÁ existe, e a recuperação correta é
  // `restaurarSessao` (só /auth/me), nunca outro cadastro.
  const cadastrar = useCallback(
    async (dados: DadosCadastroReal): Promise<ResultadoFluxoCadastro> => {
      const resultado = await authApi.cadastrar(dados);
      if (!resultado.ok) return decidirFluxoCadastro(false, resultado.falha, null);

      // Cadastro confirmado: a partir daqui o cookie de sessão já existe no
      // navegador, então qualquer /auth/me em voo de antes está obsoleto.
      geracaoRef.current += 1;
      const estadoFinal = await carregarSessao();
      return decidirFluxoCadastro(true, null, estadoFinal);
    },
    [carregarSessao],
  );

  const restaurarSessao = useCallback(async (): Promise<ResultadoFluxoCadastro> => {
    geracaoRef.current += 1;
    const estadoFinal = await carregarSessao();
    return decidirFluxoCadastro(true, null, estadoFinal);
  }, [carregarSessao]);

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
    <RealAuthContext.Provider
      value={{ estado, login, cadastrar, restaurarSessao, logout, recarregar, selecionarTenantAtivo }}
    >
      {children}
    </RealAuthContext.Provider>
  );
}

export function useRealAuth(): RealAuthContextValue {
  const contexto = useContext(RealAuthContext);
  if (!contexto) throw new Error("useRealAuth precisa ser usado dentro de <RealAuthProvider>");
  return contexto;
}
