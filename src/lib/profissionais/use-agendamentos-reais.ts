"use client";

// Estado da tela real de agendamentos (Lote 6D.5) — mesma disciplina de
// use-horarios-reais.ts e use-disponibilidade-real.ts.
//
// Descarte ao trocar de contexto: trocar de estabelecimento ou de data volta
// o estado para "carregando" e ignora resposta atrasada da combinação
// anterior (guarda a chave da chamada + AbortController).
//
// NUNCA reenvia uma criação automaticamente após falha. Não existe chave de
// idempotência no servidor (o schema não tem nenhuma), então um reenvio às
// cegas poderia duplicar a reserva — quem decide tentar de novo é a pessoa,
// depois de conferir a agenda.
import { useCallback, useEffect, useRef, useState } from "react";
import * as agendamentosApi from "@/lib/api/appointments-api";
import type {
  AgendaDoDiaReal,
  AgendamentoReal,
  DadosAgendamentoReal,
  DadosCancelamentoReal,
  DadosRemarcacaoReal,
  FalhaAgendamentoReal,
  ResultadoAgendamentoReal,
} from "@/lib/api/appointments-api";

export type EstadoAgenda =
  | { status: "carregando" }
  | { status: "carregada"; agenda: AgendaDoDiaReal }
  | { status: "falha"; falha: FalhaAgendamentoReal };

export interface AgendamentosReaisControlados {
  estado: EstadoAgenda;
  /** `true` enquanto uma criação, cancelamento ou remarcação está em voo — a
   * UI usa isto para impedir envio duplicado. Uma flag só para as três porque
   * a tela nunca deve permitir duas gravações concorrentes na mesma agenda. */
  gravando: boolean;
  recarregar: () => void;
  criar: (dados: DadosAgendamentoReal) => Promise<ResultadoAgendamentoReal<AgendamentoReal>>;
  cancelar: (
    appointmentId: string,
    dados: DadosCancelamentoReal,
  ) => Promise<ResultadoAgendamentoReal<AgendamentoReal>>;
  remarcar: (
    appointmentId: string,
    dados: DadosRemarcacaoReal,
  ) => Promise<ResultadoAgendamentoReal<AgendamentoReal>>;
}

export function useAgendamentosReais(
  tenantId: string | null,
  date: string,
): AgendamentosReaisControlados {
  const [estado, setEstado] = useState<EstadoAgenda>({ status: "carregando" });
  const [gravando, setGravando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  /** Contexto vigente conforme o render mais recente — lido pela gravação
   * para nunca aplicar resultado de um contexto que já mudou. */
  const contextoRef = useRef<string | null>(null);

  const chave = tenantId ? `${tenantId}␟${date}` : null;

  useEffect(() => {
    contextoRef.current = chave;

    if (!tenantId) {
      setEstado({ status: "carregando" });
      return;
    }

    // Descarta o que estava na tela ANTES de pedir o novo: a agenda de um
    // dia nunca fica visível sob o rótulo de outro.
    setEstado({ status: "carregando" });

    const controller = new AbortController();
    let cancelado = false;

    void (async () => {
      const resultado = await agendamentosApi.listarAgendamentos(tenantId, date, controller.signal);
      if (cancelado || contextoRef.current !== chave) return;

      setEstado(
        resultado.ok
          ? { status: "carregada", agenda: resultado.dados }
          : { status: "falha", falha: resultado.falha },
      );
    })();

    return () => {
      cancelado = true;
      controller.abort();
    };
  }, [tenantId, date, chave, recarga]);

  const recarregar = useCallback(() => setRecarga((n) => n + 1), []);

  /**
   * Disciplina única das três gravações (criar, cancelar, remarcar):
   *
   * - `gravandoRef` barra um segundo envio que já foi despachado antes do
   *   re-render desabilitar o botão — o `disabled` sozinho não cobre isso;
   * - resposta que chega depois de trocar de estabelecimento ou de dia nunca
   *   escreve na tela do novo contexto;
   * - só sucesso recarrega a agenda. Falha de comunicação NÃO recarrega nem
   *   reenvia: quem decide é a pessoa, depois de conferir a reserva.
   *
   * Uma função só para as três de propósito: duas cópias desta lógica
   * divergiriam, e é justamente aqui que mora a proteção contra duplicar uma
   * gravação que o servidor não sabe desfazer.
   */
  const gravandoRef = useRef(false);

  const enviar = useCallback(
    async (
      acao: () => Promise<ResultadoAgendamentoReal<AgendamentoReal>>,
    ): Promise<ResultadoAgendamentoReal<AgendamentoReal>> => {
      const contextoDaChamada = contextoRef.current;
      if (!tenantId || !contextoDaChamada) {
        return { ok: false, falha: { tipo: "sem_acesso" } };
      }
      // Segunda barreira contra envio duplicado, além do `disabled` do botão.
      if (gravandoRef.current) return { ok: false, falha: { tipo: "indisponivel" } };

      gravandoRef.current = true;
      setGravando(true);
      try {
        const resultado = await acao();
        if (contextoRef.current !== contextoDaChamada) return resultado;
        if (resultado.ok) setRecarga((n) => n + 1);
        return resultado;
      } finally {
        gravandoRef.current = false;
        setGravando(false);
      }
    },
    [tenantId],
  );

  const criar = useCallback(
    (dados: DadosAgendamentoReal) =>
      enviar(() => agendamentosApi.criarAgendamento(tenantId as string, dados)),
    [enviar, tenantId],
  );

  const cancelar = useCallback(
    (appointmentId: string, dados: DadosCancelamentoReal) =>
      enviar(() => agendamentosApi.cancelarAgendamento(tenantId as string, appointmentId, dados)),
    [enviar, tenantId],
  );

  const remarcar = useCallback(
    (appointmentId: string, dados: DadosRemarcacaoReal) =>
      enviar(() =>
        agendamentosApi.remarcarAgendamento(tenantId as string, appointmentId, dados),
      ),
    [enviar, tenantId],
  );

  return { estado, gravando, recarregar, criar, cancelar, remarcar };
}
