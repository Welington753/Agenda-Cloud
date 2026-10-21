"use client";

// Estado da tela de Clientes: busca por termo e cadastro, com as garantias
// que a página não deve reimplementar.
//
//  - BUSCA MAIS RECENTE VENCE: cada pesquisa recebe um número de sequência e
//    aborta a anterior. Uma resposta atrasada de um termo antigo nunca
//    sobrescreve o resultado do termo atual.
//  - TROCA DE ESTABELECIMENTO: resultados, falhas e o cadastro em exibição
//    são descartados na hora, e qualquer resposta do tenant anterior (busca ou
//    cadastro) é ignorada ao chegar.
//  - CADASTRO NUNCA É REENVIADO SOZINHO: a barreira contra envio duplicado é
//    uma ref síncrona (dois cliques no mesmo tick nunca viram dois POST), e
//    falha de comunicação vira "resultado incerto" — quem decide tentar de
//    novo é a pessoa, depois de pesquisar.
import { useCallback, useEffect, useRef, useState } from "react";
import * as clientesApi from "@/lib/api/consumers-api";
import type {
  ClienteReal,
  DadosCadastroCliente,
  FalhaClientesReal,
  ResultadoClientesReal,
} from "@/lib/api/consumers-api";

export type EstadoBuscaClientes =
  | { status: "inicial" }
  | { status: "buscando"; termo: string }
  /** `talvezIncompleta`: o backend devolveu o teto de linhas — pode haver
   * mais clientes que casam com o termo. */
  | { status: "resultado"; termo: string; clientes: ClienteReal[]; talvezIncompleta: boolean }
  | { status: "falha"; termo: string; falha: FalhaClientesReal };

export interface ClientesReais {
  busca: EstadoBuscaClientes;
  gravando: boolean;
  pesquisar: (termo: string) => void;
  /** Repete só a última leitura — nunca um cadastro. */
  repetirBusca: () => void;
  limparBusca: () => void;
  /** `null` quando o tenant mudou durante o envio: o resultado não pertence
   * mais à tela. */
  cadastrar: (dados: DadosCadastroCliente) => Promise<ResultadoClientesReal<ClienteReal> | null>;
}

export function useClientesReais(tenantId: string | null): ClientesReais {
  const [busca, setBusca] = useState<EstadoBuscaClientes>({ status: "inicial" });
  const [gravando, setGravando] = useState(false);
  const tenantAtualRef = useRef<string | null>(tenantId);
  const sequenciaRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const gravandoRef = useRef(false);
  const ultimoTermoRef = useRef<string | null>(null);

  useEffect(() => {
    tenantAtualRef.current = tenantId;
    // Invalida qualquer busca em voo do tenant anterior e limpa a tela.
    sequenciaRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    ultimoTermoRef.current = null;
    setBusca({ status: "inicial" });
  }, [tenantId]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const pesquisar = useCallback(
    (termoDigitado: string) => {
      const termo = termoDigitado.trim();
      if (!tenantId || termo.length < clientesApi.TERMO_MINIMO_BUSCA) return;

      sequenciaRef.current += 1;
      const sequencia = sequenciaRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      ultimoTermoRef.current = termo;
      setBusca({ status: "buscando", termo });

      void (async () => {
        const resultado = await clientesApi.pesquisarClientes(tenantId, termo, controller.signal);
        if (sequencia !== sequenciaRef.current || tenantAtualRef.current !== tenantId) return;
        controllerRef.current = null;

        setBusca(
          resultado.ok
            ? {
                status: "resultado",
                termo,
                clientes: resultado.dados,
                talvezIncompleta: resultado.dados.length >= clientesApi.LIMITE_BUSCA_CLIENTES,
              }
            : { status: "falha", termo, falha: resultado.falha },
        );
      })();
    },
    [tenantId],
  );

  const repetirBusca = useCallback(() => {
    if (ultimoTermoRef.current) pesquisar(ultimoTermoRef.current);
  }, [pesquisar]);

  const limparBusca = useCallback(() => {
    sequenciaRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    ultimoTermoRef.current = null;
    setBusca({ status: "inicial" });
  }, []);

  const cadastrar = useCallback(
    async (dados: DadosCadastroCliente) => {
      if (!tenantId || gravandoRef.current) return null;
      gravandoRef.current = true;
      setGravando(true);
      try {
        const resultado = await clientesApi.cadastrarCliente(tenantId, dados);
        return tenantAtualRef.current === tenantId ? resultado : null;
      } finally {
        gravandoRef.current = false;
        setGravando(false);
      }
    },
    [tenantId],
  );

  return { busca, gravando, pesquisar, repetirBusca, limparBusca, cadastrar };
}
