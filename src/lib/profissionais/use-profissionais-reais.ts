"use client";

// Estado da tela real de profissionais (Lote 6D.2) — espelho de
// servicos/use-servicos-reais.ts. Concentra aqui o que a página não deve
// reimplementar: carregamento, erro, gravação em andamento e a TROCA DE
// ESTABELECIMENTO.
//
// Troca de estabelecimento, as duas garantias exigidas pelo lote:
//  1. Os profissionais do tenant anterior são descartados IMEDIATAMENTE.
//  2. Uma resposta atrasada do tenant anterior nunca escreve estado: cada
//     chamada carrega o `tenantId` que a originou e só aplica o resultado se
//     ainda for o tenant vigente. O `AbortController` do efeito reforça isso
//     cancelando a requisição em voo.
//
// Nunca repete uma gravação automaticamente após falha de comunicação.
import { useCallback, useEffect, useRef, useState } from "react";
import * as profissionaisApi from "@/lib/api/professionals-api";
import type {
  DadosEdicaoProfissionalReal,
  DadosProfissionalReal,
  DadosVinculosReal,
  FalhaProfissionaisReal,
  ProfissionalReal,
  ResultadoProfissionaisReal,
} from "@/lib/api/professionals-api";

export type EstadoListaProfissionais =
  | { status: "carregando" }
  | { status: "carregada"; profissionais: ProfissionalReal[] }
  | { status: "falha"; falha: FalhaProfissionaisReal };

export interface ProfissionaisReais {
  estado: EstadoListaProfissionais;
  /** `true` enquanto alguma gravação está em voo — a UI usa isto para
   * impedir envio duplicado. */
  gravando: boolean;
  recarregar: () => void;
  criar: (dados: DadosProfissionalReal) => Promise<ResultadoProfissionaisReal<ProfissionalReal>>;
  editar: (
    professionalId: string,
    dados: DadosEdicaoProfissionalReal,
  ) => Promise<ResultadoProfissionaisReal<ProfissionalReal>>;
  desativar: (professionalId: string) => Promise<ResultadoProfissionaisReal<ProfissionalReal>>;
  reativar: (professionalId: string) => Promise<ResultadoProfissionaisReal<ProfissionalReal>>;
  definirServicos: (
    professionalId: string,
    dados: DadosVinculosReal,
  ) => Promise<ResultadoProfissionaisReal<ProfissionalReal>>;
}

export function useProfissionaisReais(tenantId: string | null): ProfissionaisReais {
  const [estado, setEstado] = useState<EstadoListaProfissionais>({ status: "carregando" });
  const [gravando, setGravando] = useState(false);
  const tenantAtualRef = useRef<string | null>(tenantId);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    tenantAtualRef.current = tenantId;

    if (!tenantId) {
      setEstado({ status: "carregando" });
      return;
    }

    setEstado({ status: "carregando" });

    const controller = new AbortController();
    let cancelado = false;

    void (async () => {
      const resultado = await profissionaisApi.listarProfissionais(tenantId, controller.signal);
      if (cancelado || tenantAtualRef.current !== tenantId) return;

      setEstado(
        resultado.ok
          ? { status: "carregada", profissionais: resultado.dados }
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
      acao: (tenantId: string) => Promise<ResultadoProfissionaisReal<ProfissionalReal>>,
      aplicar: (
        profissionais: ProfissionalReal[],
        salvo: ProfissionalReal,
      ) => ProfissionalReal[],
    ): Promise<ResultadoProfissionaisReal<ProfissionalReal>> => {
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
            ? { status: "carregada", profissionais: aplicar(atual.profissionais, salvo) }
            : atual,
        );
      }
      return resultado;
    },
    [],
  );

  const criar = useCallback(
    (dados: DadosProfissionalReal) =>
      gravar(
        (tenant) => profissionaisApi.criarProfissional(tenant, dados),
        (profissionais, salvo) => [...profissionais, salvo],
      ),
    [gravar],
  );

  const editar = useCallback(
    (professionalId: string, dados: DadosEdicaoProfissionalReal) =>
      gravar(
        (tenant) => profissionaisApi.editarProfissional(tenant, professionalId, dados),
        (profissionais, salvo) => profissionais.map((p) => (p.id === salvo.id ? salvo : p)),
      ),
    [gravar],
  );

  const desativar = useCallback(
    (professionalId: string) =>
      gravar(
        (tenant) => profissionaisApi.desativarProfissional(tenant, professionalId),
        (profissionais, salvo) => profissionais.map((p) => (p.id === salvo.id ? salvo : p)),
      ),
    [gravar],
  );

  const reativar = useCallback(
    (professionalId: string) =>
      gravar(
        (tenant) => profissionaisApi.reativarProfissional(tenant, professionalId),
        (profissionais, salvo) => profissionais.map((p) => (p.id === salvo.id ? salvo : p)),
      ),
    [gravar],
  );

  const definirServicos = useCallback(
    (professionalId: string, dados: DadosVinculosReal) =>
      gravar(
        (tenant) => profissionaisApi.definirServicosDoProfissional(tenant, professionalId, dados),
        (profissionais, salvo) => profissionais.map((p) => (p.id === salvo.id ? salvo : p)),
      ),
    [gravar],
  );

  return { estado, gravando, recarregar, criar, editar, desativar, reativar, definirServicos };
}
