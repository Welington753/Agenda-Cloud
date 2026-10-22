"use client";

// Leituras da página pública de agendamento (página e horários). As duas
// usam a recuperação comum (lib/api/leitura-com-recuperacao.ts): se a
// hospedagem gratuita estiver acordando, o estado traz a fase
// ("acordando"/"sem_internet") e a leitura tenta de novo sozinha, dentro do
// prazo. Só LEITURAS: o envio do pedido fica em page.tsx e nunca se repete.
import { useCallback, useEffect, useRef, useState } from "react";
import { lerComRecuperacao, type FaseRecuperacao } from "@/lib/api/leitura-com-recuperacao";
import {
  consultarHorariosPublicos,
  obterPaginaPublica,
  type FalhaPublica,
  type PaginaPublica,
  type ResultadoPublico,
} from "@/lib/api/public-booking-api";
import type { EstadoHorarios } from "./escolhas";

export type EstadoPagina =
  | { status: "carregando"; fase?: FaseRecuperacao }
  | { status: "falha"; falha: FalhaPublica }
  | { status: "pronta"; pagina: PaginaPublica };

/** Só "a API não respondeu" é repetido. Página inexistente, recusa, limite
 * de tentativas e erro da própria API são conclusivos. */
function repetirLeituraPublica<T>(r: ResultadoPublico<T>): boolean {
  return !r.ok && r.falha.tipo === "falha_comunicacao";
}

export function usePaginaPublica(slug: string) {
  const [estado, setEstado] = useState<EstadoPagina>({ status: "carregando" });
  // Leitura em andamento: uma por vez; uma nova (ou sair da página) cancela
  // a anterior, e a resposta dela é descartada.
  const leituraRef = useRef<AbortController | null>(null);

  const carregarPagina = useCallback(async () => {
    leituraRef.current?.abort();
    const controle = new AbortController();
    leituraRef.current = controle;
    const vigente = () => leituraRef.current === controle;
    setEstado({ status: "carregando" });
    const desfecho = await lerComRecuperacao(
      (signal) => obterPaginaPublica(slug, signal),
      repetirLeituraPublica,
      controle.signal,
      {
        aoMudarFase: (fase) => {
          if (vigente()) setEstado({ status: "carregando", fase });
        },
      },
    );
    if (desfecho === null || !vigente()) return;
    leituraRef.current = null;
    const r = desfecho.resultado;
    setEstado(r.ok ? { status: "pronta", pagina: r.dados } : { status: "falha", falha: r.falha });
  }, [slug]);

  useEffect(() => {
    void carregarPagina();
    return () => {
      leituraRef.current?.abort();
      leituraRef.current = null;
    };
  }, [carregarPagina]);

  // Internet de volta depois de a página não carregar: tenta de novo uma
  // vez, sem esperar o clique. Evento do navegador, nunca um temporizador.
  const falhouSemResposta = estado.status === "falha" && estado.falha.tipo === "falha_comunicacao";
  useEffect(() => {
    if (!falhouSemResposta) return;
    const aoVoltarOnline = () => void carregarPagina();
    window.addEventListener("online", aoVoltarOnline);
    return () => window.removeEventListener("online", aoVoltarOnline);
  }, [falhouSemResposta, carregarPagina]);

  return { estado, carregarPagina };
}

/** Horários do dia escolhido. Mudar a escolha (ou `versao`) cancela a
 * leitura anterior; só a última aplica resultado. */
export function useHorariosPublicos(
  slug: string,
  consulta: { serviceId: string | null; professionalId: string | null; date: string | null },
  versao: number,
): EstadoHorarios {
  const { serviceId, professionalId, date } = consulta;
  const [horarios, setHorarios] = useState<EstadoHorarios>({ status: "ocioso" });

  useEffect(() => {
    if (!serviceId || !professionalId || !date) {
      setHorarios({ status: "ocioso" });
      return;
    }
    const controle = new AbortController();
    setHorarios({ status: "carregando" });
    void lerComRecuperacao(
      (signal) => consultarHorariosPublicos(slug, { serviceId, professionalId, date }, signal),
      repetirLeituraPublica,
      controle.signal,
      {
        aoMudarFase: (fase) => {
          if (!controle.signal.aborted) setHorarios({ status: "carregando", fase });
        },
      },
    ).then((desfecho) => {
      if (desfecho === null || controle.signal.aborted) return;
      const r = desfecho.resultado;
      setHorarios(r.ok ? { status: "pronto", horarios: r.dados } : { status: "falha", falha: r.falha });
    });
    return () => controle.abort();
  }, [slug, serviceId, professionalId, date, versao]);

  return horarios;
}
