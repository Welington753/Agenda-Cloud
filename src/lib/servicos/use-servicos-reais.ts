"use client";

// Estado da tela real de serviços (Lote 6D.1). Concentra aqui o que a página
// não deve reimplementar: carregamento, erro, gravação em andamento e —
// principalmente — a TROCA DE ESTABELECIMENTO.
//
// Troca de estabelecimento, as duas garantias exigidas pelo lote:
//  1. Os serviços do tenant anterior são descartados IMEDIATAMENTE (o estado
//     volta para "carregando", nunca fica mostrando a lista antiga enquanto a
//     nova chega).
//  2. Uma resposta atrasada do tenant anterior nunca escreve estado: cada
//     chamada carrega o `tenantId` que a originou e só aplica o resultado se
//     ainda for o tenant vigente. O `AbortController` do efeito reforça isso
//     cancelando a requisição em voo.
//
// Nunca repete uma gravação automaticamente após falha de comunicação — quem
// decide tentar de novo é a pessoa, com um clique explícito.
import { useCallback, useEffect, useRef, useState } from "react";
import * as servicosApi from "@/lib/api/services-api";
import type {
  DadosServicoReal,
  FalhaServicosReal,
  ResultadoServicosReal,
  ServicoReal,
} from "@/lib/api/services-api";

export type EstadoListaServicos =
  | { status: "carregando" }
  | { status: "carregada"; servicos: ServicoReal[] }
  | { status: "falha"; falha: FalhaServicosReal };

export interface ServicosReais {
  estado: EstadoListaServicos;
  /** `true` enquanto alguma gravação está em voo — a UI usa isto para impedir
   * envio duplicado. */
  gravando: boolean;
  recarregar: () => void;
  criar: (dados: DadosServicoReal) => Promise<ResultadoServicosReal<ServicoReal>>;
  editar: (
    serviceId: string,
    dados: Partial<DadosServicoReal>,
  ) => Promise<ResultadoServicosReal<ServicoReal>>;
  desativar: (serviceId: string) => Promise<ResultadoServicosReal<ServicoReal>>;
}

export function useServicosReais(tenantId: string | null): ServicosReais {
  const [estado, setEstado] = useState<EstadoListaServicos>({ status: "carregando" });
  const [gravando, setGravando] = useState(false);
  // Tenant vigente conforme o RENDER mais recente — lido pelas gravações para
  // nunca aplicarem o resultado de um estabelecimento que já não está ativo.
  const tenantAtualRef = useRef<string | null>(tenantId);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    tenantAtualRef.current = tenantId;

    if (!tenantId) {
      setEstado({ status: "carregando" });
      return;
    }

    // Descarta a lista anterior ANTES de pedir a nova: a tela nunca mostra
    // serviço de um estabelecimento enquanto exibe o nome de outro.
    setEstado({ status: "carregando" });

    const controller = new AbortController();
    let cancelado = false;

    void (async () => {
      const resultado = await servicosApi.listarServicos(tenantId, controller.signal);
      // Dupla proteção: o efeito foi limpo (troca de tenant/desmontagem) ou o
      // tenant vigente já é outro.
      if (cancelado || tenantAtualRef.current !== tenantId) return;

      setEstado(
        resultado.ok
          ? { status: "carregada", servicos: resultado.dados }
          : { status: "falha", falha: resultado.falha },
      );
    })();

    return () => {
      cancelado = true;
      controller.abort();
    };
  }, [tenantId, recarga]);

  const recarregar = useCallback(() => setRecarga((n) => n + 1), []);

  /** Envolve uma gravação: bloqueia envio concorrente, e só aplica o
   * resultado se o estabelecimento ainda for o mesmo de quando começou.
   * Nunca tenta de novo sozinho. */
  const gravar = useCallback(
    async (
      acao: (tenantId: string) => Promise<ResultadoServicosReal<ServicoReal>>,
      aplicar: (servicos: ServicoReal[], salvo: ServicoReal) => ServicoReal[],
    ): Promise<ResultadoServicosReal<ServicoReal>> => {
      const tenantDaChamada = tenantAtualRef.current;
      if (!tenantDaChamada) return { ok: false, falha: { tipo: "sem_acesso" } };

      setGravando(true);
      const resultado = await acao(tenantDaChamada);
      setGravando(false);

      if (tenantAtualRef.current !== tenantDaChamada) return resultado;
      if (resultado.ok) {
        const salvo = resultado.dados;
        setEstado((atual) =>
          atual.status === "carregada"
            ? { status: "carregada", servicos: aplicar(atual.servicos, salvo) }
            : atual,
        );
      }
      return resultado;
    },
    [],
  );

  const criar = useCallback(
    (dados: DadosServicoReal) =>
      gravar(
        (tenant) => servicosApi.criarServico(tenant, dados),
        (servicos, salvo) => [...servicos, salvo],
      ),
    [gravar],
  );

  const editar = useCallback(
    (serviceId: string, dados: Partial<DadosServicoReal>) =>
      gravar(
        (tenant) => servicosApi.editarServico(tenant, serviceId, dados),
        (servicos, salvo) => servicos.map((s) => (s.id === salvo.id ? salvo : s)),
      ),
    [gravar],
  );

  const desativar = useCallback(
    (serviceId: string) =>
      gravar(
        (tenant) => servicosApi.desativarServico(tenant, serviceId),
        (servicos, salvo) => servicos.map((s) => (s.id === salvo.id ? salvo : s)),
      ),
    [gravar],
  );

  return { estado, gravando, recarregar, criar, editar, desativar };
}
