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
import { usePathname } from "next/navigation";
import * as authApi from "@/lib/api/auth-api";
import type { ResultadoAutenticacaoReal, SessaoRealContexto } from "@/lib/api/auth-api";
import { lerComRecuperacao } from "@/lib/api/leitura-com-recuperacao";
import { LIMIAR_RETORNO_MS, aplicarVerificacao, rotaDispensaSessao, type EstadoConexao } from "./conexao";
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
  /** Situação da conexão com a API enquanto uma leitura de sessão tenta
   * alcançá-la (ver conexao.ts). Independente de `estado`: reconectar nunca
   * desmonta a tela autenticada. */
  conexao: EstadoConexao;
  login: (email: string, senha: string) => Promise<ResultadoAutenticacaoReal<SessaoRealContexto>>;
  /** Relê SÓ o /auth/me, depois de outra rota ter aberto a sessão (aceite de
   * convite). Devolve a sessão restaurada, ou `null` se ela ainda não veio:
   * nunca repete o pedido que abriu a sessão. */
  restaurarSessao: () => Promise<SessaoRealContexto | null>;
  logout: () => Promise<ResultadoLogout>;
  /** "Tentar novamente": refaz a leitura com recuperação. Ignorado com uma
   * leitura já em andamento. */
  recarregar: () => void;
  selecionarTenantAtivo: (tenantId: string) => boolean;
}

const RealAuthContext = createContext<RealAuthContextValue | undefined>(undefined);

export function RealAuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoAutenticacaoReal>({ status: "carregando" });
  const [conexao, setConexao] = useState<EstadoConexao>("ok");
  // Cópia para os ouvintes de eventos do navegador (sem recriá-los a cada
  // mudança de estado).
  const estadoRef = useRef(estado);
  const conexaoRef = useRef(conexao);
  useEffect(() => {
    estadoRef.current = estado;
    conexaoRef.current = conexao;
  }, [estado, conexao]);
  // Já existe um estado decidido pela API (ou por login/logout). Enquanto
  // não, a abertura da página ainda precisa ler a sessão.
  const sessaoDecididaRef = useRef(false);
  const pathname = usePathname();
  const precisaDeSessao = !rotaDispensaSessao(pathname);
  // Incrementada a cada ação que decide autoritativamente o novo estado
  // (login, logout, recarregar) — uma resposta assíncrona só pode aplicar seu
  // resultado se a geração não mudou enquanto ela estava em voo (ver
  // `podeAplicarResultado`). É isto que impede uma resposta atrasada de
  // /auth/me restaurar a sessão depois de um logout.
  const geracaoRef = useRef(0);
  // Leitura de /auth/me em andamento (com suas esperas entre tentativas).
  // Nunca há duas ao mesmo tempo: uma nova cancela a anterior, e login,
  // logout e a desmontagem do provider também cancelam.
  const leituraRef = useRef<AbortController | null>(null);

  const cancelarLeitura = useCallback(() => {
    if (leituraRef.current === null) return;
    leituraRef.current.abort();
    leituraRef.current = null;
    setConexao("ok");
  }, []);

  // Modos:
  // - `abertura`: com recuperação (lerComRecuperacao); o resultado decide a
  //   tela (carregando → autenticado / login / falha);
  // - `verificacao`: com recuperação, mas com a tela já decidida (volta ao
  //   aplicativo, conexão de volta). Nunca troca a tela por carregamento ou
  //   falha (ver `aplicarVerificacao`);
  // - `unica`: UMA leitura, sem repetição (logo depois do aceite de convite).
  // Devolve o estado efetivamente aplicado, ou `null` quando a resposta
  // chegou tarde demais (geração mudou ou leitura cancelada) e foi
  // descartada — quem chamou precisa saber a diferença entre "sessão
  // restaurada" e "não deu".
  const carregarSessao = useCallback(
    async (modo: "abertura" | "verificacao" | "unica"): Promise<EstadoAutenticacaoReal | null> => {
      cancelarLeitura();
      const controle = new AbortController();
      leituraRef.current = controle;
      const geracaoDaChamada = geracaoRef.current;
      const vigente = () => leituraRef.current === controle;

      let resultado: ResultadoAutenticacaoReal<SessaoRealContexto | null> | null;
      if (modo === "unica") {
        const unico = await authApi.buscarSessaoAtual(controle.signal);
        resultado = controle.signal.aborted ? null : unico;
      } else {
        const desfecho = await lerComRecuperacao(
          (signal) => authApi.buscarSessaoAtual(signal),
          (r) => !r.ok && r.falha.tipo === "falha_comunicacao",
          controle.signal,
          {
            aoMudarFase: (fase) => {
              if (vigente()) setConexao(fase);
            },
          },
        );
        resultado = desfecho?.resultado ?? null;
      }
      if (!vigente()) return null;
      leituraRef.current = null;
      if (resultado === null || !podeAplicarResultado(geracaoRef.current, geracaoDaChamada)) {
        setConexao("ok");
        return null;
      }
      sessaoDecididaRef.current = true;
      if (modo === "verificacao") {
        const decisao = aplicarVerificacao(estadoRef.current, resultado, lerPreferenciaTenant());
        setConexao(decisao.conexao);
        setEstado(decisao.estado);
        return decisao.estado;
      }
      const proximo = reduzirResultadoSessao(resultado, lerPreferenciaTenant());
      setConexao("ok");
      setEstado(proximo);
      return proximo;
    },
    [cancelarLeitura],
  );

  // Abertura: lê a sessão uma vez, só nas rotas que a usam. Sair para uma
  // rota sem sessão no meio da leitura a cancela; voltar recomeça.
  useEffect(() => {
    if (!precisaDeSessao || sessaoDecididaRef.current) return;
    void carregarSessao("abertura");
    return cancelarLeitura;
  }, [precisaDeSessao, carregarSessao, cancelarLeitura]);

  // "Tentar novamente" (tela de falha ou aviso de conexão) e retorno da
  // internet. Tela de falha: volta a `carregando` e lê de novo. Tela já
  // aberta: verificação, sem desmontar nada. Nunca empilha leituras.
  const recarregar = useCallback(() => {
    if (leituraRef.current !== null) return;
    if (estadoRef.current.status === "falha_comunicacao" || !sessaoDecididaRef.current) {
      setEstado((atual) => (atual.status === "falha_comunicacao" ? { status: "carregando" } : atual));
      void carregarSessao("abertura");
      return;
    }
    void carregarSessao("verificacao");
  }, [carregarSessao]);

  // Eventos de acesso real, nunca um temporizador: voltar ao aplicativo
  // depois de LIMIAR_RETORNO_MS oculto, ou a internet voltar depois de uma
  // falha. Cada um faz no máximo UMA leitura com recuperação, que termina
  // quando a API responde ou o prazo acaba.
  useEffect(() => {
    if (!precisaDeSessao) return;
    let ocultaDesde: number | null = document.visibilityState === "hidden" ? Date.now() : null;

    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "hidden") {
        ocultaDesde ??= Date.now();
        return;
      }
      const ficouOculta = ocultaDesde !== null && Date.now() - ocultaDesde >= LIMIAR_RETORNO_MS;
      ocultaDesde = null;
      if (ficouOculta && sessaoDecididaRef.current) recarregar();
    };
    // iPhone: o aplicativo pode voltar da memória (bfcache) sem
    // `visibilitychange`; `persisted` só é verdadeiro nesse retorno.
    const aoMostrarPagina = (evento: PageTransitionEvent) => {
      if (evento.persisted && sessaoDecididaRef.current) recarregar();
    };
    const aoVoltarOnline = () => {
      if (estadoRef.current.status === "falha_comunicacao" || conexaoRef.current === "sem_resposta") recarregar();
    };

    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    window.addEventListener("pageshow", aoMostrarPagina);
    window.addEventListener("online", aoVoltarOnline);
    return () => {
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      window.removeEventListener("pageshow", aoMostrarPagina);
      window.removeEventListener("online", aoVoltarOnline);
    };
  }, [precisaDeSessao, recarregar]);

  const login = useCallback(async (email: string, senha: string) => {
    cancelarLeitura();
    geracaoRef.current += 1;
    const geracaoDaChamada = geracaoRef.current;
    const resultado = await authApi.login(email, senha);
    if (podeAplicarResultado(geracaoRef.current, geracaoDaChamada) && resultado.ok) {
      sessaoDecididaRef.current = true;
      setEstado(reduzirResultadoSessao({ ok: true, dados: resultado.dados }, lerPreferenciaTenant()));
    }
    return resultado;
  }, [cancelarLeitura]);

  // O cookie novo já existe no navegador: qualquer /auth/me em voo de antes
  // está obsoleto (nova geração).
  const restaurarSessao = useCallback(async (): Promise<SessaoRealContexto | null> => {
    geracaoRef.current += 1;
    const estadoFinal = await carregarSessao("unica");
    return estadoFinal?.status === "autenticado" ? estadoFinal.sessao : null;
  }, [carregarSessao]);

  const logout = useCallback(async (): Promise<ResultadoLogout> => {
    // Sai imediatamente na UI (otimista) — nunca deixa a tela autenticada
    // visível enquanto espera a rede; a geração muda ANTES do await, então
    // nenhuma resposta de /auth/me já em voo consegue mais escrever estado.
    cancelarLeitura();
    sessaoDecididaRef.current = true;
    geracaoRef.current += 1;
    salvarPreferenciaTenant(null);
    setEstado({ status: "nao_autenticado" });

    const resultado = await authApi.logout();
    return { confirmadoPeloServidor: resultado.ok };
  }, [cancelarLeitura]);

  const selecionarTenantAtivo = useCallback((tenantId: string): boolean => {
    // A decisão vem do estado já renderizado, não de dentro do updater: o
    // React só roda o updater na hora quando a fila do componente está vazia;
    // com outra atualização pendente ele fica para a próxima renderização, e
    // quem chamou receberia `false` mesmo com a troca aplicada depois.
    const atual = estadoRef.current;
    if (selecionarTenant(atual, tenantId) === atual) return false;
    setEstado((pendente) => selecionarTenant(pendente, tenantId));
    salvarPreferenciaTenant(tenantId);
    return true;
  }, []);

  return (
    <RealAuthContext.Provider
      value={{ estado, conexao, login, restaurarSessao, logout, recarregar, selecionarTenantAtivo }}
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
