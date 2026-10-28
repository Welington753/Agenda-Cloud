"use client";

// Solicitações pendentes do estabelecimento ativo, lidas do backend
// (GET /tenants/:id/booking-requests), e os avisos de NOVAS solicitações.
//
// UMA leitura para a área real inteira: `SolicitacoesProvider` fica no
// layout de `/conta` e o contador do menu, o aviso da Visão geral, a tela de
// Solicitações e os avisos flutuantes usam a mesma lista. Nada aqui grava:
// abrir um aviso, ver o número ou a lista não muda reserva nenhuma — só
// confirmar ou recusar, na tela de Solicitações, muda.
//
// Consulta periódica (ver novas-solicitacoes.ts):
// - a cada INTERVALO_DE_CONSULTA_MS, SÓ com a página visível e com conexão;
//   oculta ou offline, nada é agendado (não é um "ping" para manter o
//   servidor acordado). Ao voltar a ficar visível ou online, consulta na hora;
// - SEQUENCIAL: a próxima só é agendada quando a anterior termina, e nunca há
//   duas em voo;
// - trocar de estabelecimento, sair ou desmontar cancela a leitura em voo e
//   descarta lista, avisos e memória do anterior (tudo é marcado com a chave
//   usuário+estabelecimento e só vale para ela).
//
// Os avisos funcionam com o sistema ABERTO neste navegador. Não há push nem
// aviso com o navegador fechado.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { temArea } from "@/lib/conta/papel";
import {
  listarSolicitacoes,
  type FalhaPrivada,
  type ListaDeSolicitacoes,
  type SolicitacaoPendente,
} from "@/lib/api/booking-requests-api";
import {
  INTERVALO_DE_CONSULTA_MS,
  compararLeitura,
  falhaDefinitiva,
  podeConsultar,
  type MemoriaDeAvisos,
} from "./novas-solicitacoes";
import { lerPreferenciaDeSom, prepararSom, tocarSom } from "./som-dos-avisos";

const EVENTO = "agenda-cloud:solicitacoes-alteradas";

export type EstadoSolicitacoes =
  | { status: "carregando" }
  | { status: "falha"; falha: FalhaPrivada }
  | {
      status: "carregada";
      lista: ListaDeSolicitacoes;
      /** A última consulta falhou por comunicação: esta é a lista anterior. */
      desatualizada?: boolean;
    };

/** Outra parte da área real mudou uma reserva: relê a lista agora. */
export function avisarSolicitacoesAlteradas(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO));
}

interface ValorSolicitacoes {
  estado: EstadoSolicitacoes;
  /** Relê agora (depois de confirmar/recusar ou pelo botão "Atualizar"). */
  recarregar: () => void;
  /** Novas solicitações desta sessão ainda não dispensadas. */
  avisos: readonly SolicitacaoPendente[];
  dispensarAviso: (id: string) => void;
  /** Solicitação aberta por "Ver solicitação", para a tela destacar. */
  destaque: string | null;
  abrirSolicitacao: (id: string) => void;
  limparDestaque: () => void;
}

const CARREGANDO: EstadoSolicitacoes = { status: "carregando" };
const SEM_AVISOS: readonly SolicitacaoPendente[] = [];

const Contexto = createContext<ValorSolicitacoes | undefined>(undefined);

export function SolicitacoesProvider({ children }: { children: ReactNode }) {
  const { estado: sessao } = useRealAuth();
  const pathname = usePathname();
  // Só quem vê solicitações (o dono, ou o gerente a quem o dono concedeu):
  // para o funcionário e os papéis sem área não há leitura nenhuma, nem
  // periódica — o servidor recusaria todas.
  const ativo = sessao.status === "autenticado" && sessao.tenantIdAtivo
    ? sessao.sessao.contexts.find((c) => c.tenantId === sessao.tenantIdAtivo)
    : undefined;
  const tenantId = ativo && (ativo.role === "DONO" || temArea(ativo, "SOLICITACOES_VER")) ? ativo.tenantId : null;
  const userId = sessao.status === "autenticado" ? sessao.sessao.user.id : null;
  const chave = tenantId && userId ? `${userId}:${tenantId}` : null;

  const [leitura, setLeitura] = useState<{ chave: string; estado: EstadoSolicitacoes } | null>(null);
  const [avisos, setAvisos] = useState<{ chave: string; itens: SolicitacaoPendente[] } | null>(null);
  const [destaque, setDestaque] = useState<{ chave: string; id: string } | null>(null);
  // `forcar`: a leitura em voo pode ser anterior a uma mudança (confirmar,
  // recusar, "Atualizar") — então lê de novo quando ela terminar. Sem forçar
  // (navegar, voltar à aba), a leitura em voo já serve.
  const consultarRef = useRef<(forcar: boolean) => void>(() => undefined);

  useEffect(() => {
    if (!chave || !tenantId) return;
    // Constantes deste estabelecimento: as funções abaixo nunca leem os de outro.
    const chaveAtual = chave;
    const tenantAtual = tenantId;
    let ativo = true;
    let controle: AbortController | null = null;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let emVoo = false;
    let deNovo = false;
    let memoria: MemoriaDeAvisos | null = null;

    function pararEspera() {
      if (temporizador !== undefined) clearTimeout(temporizador);
      temporizador = undefined;
    }

    async function consultar(forcar: boolean) {
      if (!ativo) return;
      if (emVoo) {
        if (forcar) deNovo = true;
        return;
      }
      pararEspera();
      if (!podeConsultar(document.visibilityState, navigator.onLine)) return;

      emVoo = true;
      controle = new AbortController();
      const r = await listarSolicitacoes(tenantAtual, controle.signal);
      emVoo = false;
      controle = null;
      if (!ativo) return;

      let continuar = true;
      if (r.ok) {
        const comparacao = compararLeitura(memoria, r.dados);
        memoria = comparacao.memoria;
        const pendentes = new Set(r.dados.solicitacoes.map((s) => s.id));
        setLeitura({ chave: chaveAtual, estado: { status: "carregada", lista: r.dados } });
        // Aviso de solicitação que já saiu da lista (respondida em outro
        // lugar) some; as novas entram no fim.
        setAvisos((atual) => ({
          chave: chaveAtual,
          itens: [
            ...(atual?.chave === chaveAtual ? atual.itens : []).filter((a) => pendentes.has(a.id)),
            ...comparacao.novas,
          ],
        }));
        if (comparacao.novas.length > 0 && lerPreferenciaDeSom()) tocarSom();
      } else {
        const definitiva = falhaDefinitiva(r.falha.tipo);
        // Falha passageira com lista já carregada: mantém a lista (marcada
        // como desatualizada) em vez de esconder as solicitações.
        setLeitura((atual) =>
          !definitiva && atual?.chave === chaveAtual && atual.estado.status === "carregada"
            ? { chave: chaveAtual, estado: { ...atual.estado, desatualizada: true } }
            : { chave: chaveAtual, estado: { status: "falha", falha: r.falha } },
        );
        if (definitiva) {
          setAvisos({ chave: chaveAtual, itens: [] });
          continuar = false;
        }
      }

      if (deNovo) {
        deNovo = false;
        void consultar(false);
        return;
      }
      if (continuar) temporizador = setTimeout(() => void consultar(false), INTERVALO_DE_CONSULTA_MS);
    }

    function aoMudarVisibilidade() {
      if (document.visibilityState === "visible") void consultar(false);
      else pararEspera();
    }
    const aoVoltarOnline = () => void consultar(false);
    const aoFicarOffline = () => pararEspera();
    const aoAlterar = () => void consultar(true);

    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    window.addEventListener("online", aoVoltarOnline);
    window.addEventListener("offline", aoFicarOffline);
    window.addEventListener(EVENTO, aoAlterar);
    consultarRef.current = (forcar) => void consultar(forcar);
    void consultar(false);

    return () => {
      ativo = false;
      controle?.abort();
      pararEspera();
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      window.removeEventListener("online", aoVoltarOnline);
      window.removeEventListener("offline", aoFicarOffline);
      window.removeEventListener(EVENTO, aoAlterar);
      consultarRef.current = () => undefined;
    };
  }, [chave, tenantId]);

  // Cada navegação confere a lista (sem duplicar uma leitura em voo).
  useEffect(() => consultarRef.current(false), [pathname]);

  // Som ligado de antes: o navegador só libera áudio depois de um gesto,
  // então o primeiro clique ou tecla na página prepara o som.
  useEffect(() => {
    if (!lerPreferenciaDeSom()) return;
    const liberar = () => prepararSom();
    document.addEventListener("pointerdown", liberar, { once: true });
    document.addEventListener("keydown", liberar, { once: true });
    return () => {
      document.removeEventListener("pointerdown", liberar);
      document.removeEventListener("keydown", liberar);
    };
  }, []);

  const recarregar = useCallback(() => consultarRef.current(true), []);
  const dispensarAviso = useCallback((id: string) => {
    setAvisos((atual) => atual && { chave: atual.chave, itens: atual.itens.filter((a) => a.id !== id) });
  }, []);
  const abrirSolicitacao = useCallback(
    (id: string) => {
      dispensarAviso(id);
      if (chave) setDestaque({ chave, id });
    },
    [chave, dispensarAviso],
  );
  const limparDestaque = useCallback(() => setDestaque(null), []);

  const valor = useMemo<ValorSolicitacoes>(
    () => ({
      estado: chave && leitura?.chave === chave ? leitura.estado : CARREGANDO,
      recarregar,
      avisos: chave && avisos?.chave === chave ? avisos.itens : SEM_AVISOS,
      dispensarAviso,
      destaque: chave && destaque?.chave === chave ? destaque.id : null,
      abrirSolicitacao,
      limparDestaque,
    }),
    [chave, leitura, avisos, destaque, recarregar, dispensarAviso, abrirSolicitacao, limparDestaque],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

function useContexto(): ValorSolicitacoes {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("useSolicitacoesPendentes precisa estar dentro de <SolicitacoesProvider>");
  return valor;
}

/** Lista pendente do estabelecimento ativo (a mesma em toda a área real). */
export function useSolicitacoesPendentes() {
  const { estado, recarregar } = useContexto();
  return { estado, recarregar };
}

/** Avisos de novas solicitações e o destaque de "Ver solicitação". */
export function useAvisosDeSolicitacoes() {
  const { avisos, dispensarAviso, destaque, abrirSolicitacao, limparDestaque } = useContexto();
  return { avisos, dispensarAviso, destaque, abrirSolicitacao, limparDestaque };
}

/** Quantas pendentes mostrar no menu: só com lista carregada. Falha ou
 * carregamento não viram "0" (zero afirmaria que não há nada). */
export function contagemVisivel(estado: EstadoSolicitacoes): number | null {
  return estado.status === "carregada" ? estado.lista.solicitacoes.length : null;
}
