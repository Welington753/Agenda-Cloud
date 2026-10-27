"use client";

// Estado da tela de Clientes: listagem paginada no servidor (a primeira
// página carrega ao abrir), busca que filtra a mesma listagem e cadastro, com
// as garantias que a página não deve reimplementar.
//
//  - LEITURA MAIS RECENTE VENCE: cada listagem recebe um número de sequência e
//    aborta a anterior. Uma resposta atrasada de um termo antigo nunca
//    sobrescreve o resultado do termo atual, e "Carregar mais" de uma lista
//    que já foi trocada é ignorado.
//  - NADA DE "TODOS NO NAVEGADOR": cada leitura traz uma página (cursor do
//    servidor); o total vem contado pelo servidor.
//  - TROCA DE ESTABELECIMENTO: lista, falhas e o cadastro em exibição são
//    descartados na hora, e qualquer resposta do tenant anterior é ignorada.
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

export type EstadoListaClientes =
  | { status: "carregando"; termo: string | null }
  | {
      status: "pronta";
      /** `null`: sem filtro (todos os clientes, em páginas). */
      termo: string | null;
      clientes: ClienteReal[];
      total: number;
      proximoCursor: string | null;
      carregandoMais: boolean;
      falhaAoCarregarMais: FalhaClientesReal | null;
    }
  | { status: "falha"; termo: string | null; falha: FalhaClientesReal };

export interface ClientesReais {
  lista: EstadoListaClientes;
  gravando: boolean;
  /** Recomeça a listagem: sem termo (ou com menos de 2 letras), todos. */
  listar: (termo?: string | null) => void;
  carregarMais: () => void;
  /** Repete a última leitura — nunca um cadastro. */
  repetir: () => void;
  /** `null` quando o tenant mudou durante o envio: o resultado não pertence
   * mais à tela. */
  cadastrar: (dados: DadosCadastroCliente) => Promise<ResultadoClientesReal<ClienteReal> | null>;
}

function termoValido(termo: string | null | undefined): string | null {
  const limpo = termo?.trim() ?? "";
  return limpo.length >= clientesApi.TERMO_MINIMO_BUSCA ? limpo : null;
}

export function useClientesReais(tenantId: string | null): ClientesReais {
  const [lista, setLista] = useState<EstadoListaClientes>({ status: "carregando", termo: null });
  const [gravando, setGravando] = useState(false);
  const tenantAtualRef = useRef<string | null>(tenantId);
  const sequenciaRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const gravandoRef = useRef(false);
  const termoAtualRef = useRef<string | null>(null);
  const listaRef = useRef(lista);
  useEffect(() => {
    listaRef.current = lista;
  }, [lista]);

  const listar = useCallback(
    (termoDigitado?: string | null) => {
      if (!tenantId) return;
      const termo = termoValido(termoDigitado);
      sequenciaRef.current += 1;
      const sequencia = sequenciaRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      termoAtualRef.current = termo;
      setLista({ status: "carregando", termo });

      void (async () => {
        const resultado = await clientesApi.listarPaginaDeClientes(
          tenantId,
          { termo: termo ?? undefined },
          controller.signal,
        );
        if (sequencia !== sequenciaRef.current || tenantAtualRef.current !== tenantId) return;
        controllerRef.current = null;
        setLista(
          resultado.ok
            ? {
                status: "pronta",
                termo,
                clientes: resultado.dados.clientes,
                total: resultado.dados.total,
                proximoCursor: resultado.dados.proximoCursor,
                carregandoMais: false,
                falhaAoCarregarMais: null,
              }
            : { status: "falha", termo, falha: resultado.falha },
        );
      })();
    },
    [tenantId],
  );

  // A primeira página carrega ao abrir e a cada troca de estabelecimento.
  useEffect(() => {
    tenantAtualRef.current = tenantId;
    listar(null);
  }, [tenantId, listar]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const carregarMais = useCallback(() => {
    const atual = listaRef.current;
    if (!tenantId || atual.status !== "pronta" || !atual.proximoCursor || atual.carregandoMais) return;
    const sequencia = sequenciaRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLista({ ...atual, carregandoMais: true, falhaAoCarregarMais: null });

    void (async () => {
      const resultado = await clientesApi.listarPaginaDeClientes(
        tenantId,
        { termo: atual.termo ?? undefined, cursor: atual.proximoCursor },
        controller.signal,
      );
      // Outra listagem começou (novo termo, tenant): esta página não vale mais.
      if (sequencia !== sequenciaRef.current || tenantAtualRef.current !== tenantId) return;
      controllerRef.current = null;
      setLista((anterior) => {
        if (anterior.status !== "pronta") return anterior;
        if (!resultado.ok) return { ...anterior, carregandoMais: false, falhaAoCarregarMais: resultado.falha };
        const vistos = new Set(anterior.clientes.map((c) => c.id));
        return {
          ...anterior,
          clientes: [...anterior.clientes, ...resultado.dados.clientes.filter((c) => !vistos.has(c.id))],
          total: resultado.dados.total,
          proximoCursor: resultado.dados.proximoCursor,
          carregandoMais: false,
          falhaAoCarregarMais: null,
        };
      });
    })();
  }, [tenantId]);

  const repetir = useCallback(() => listar(termoAtualRef.current), [listar]);

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

  return { lista, gravando, listar, carregarMais, repetir, cadastrar };
}
