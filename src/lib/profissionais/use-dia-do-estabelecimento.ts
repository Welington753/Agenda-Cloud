"use client";

// O dia que a agenda mostra, no fuso do ESTABELECIMENTO. Extraído da página da
// agenda quando a Visão geral passou a precisar da mesma regra — duas cópias
// dela divergiriam justamente perto da meia-noite.
//
// O fuso só é conhecido depois da primeira resposta da agenda (ele vem junto,
// em `timezone`). Até lá, o ponto de partida é o dia do NAVEGADOR; quando a
// primeira agenda chega, `sincronizar` troca esse dia pelo "hoje" do
// estabelecimento — a menos que a pessoa já tenha escolhido um dia, escolha
// que nunca é desfeita por baixo dela.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgendaDoDiaReal } from "@/lib/api/appointments-api";
import { comoDataDeCalendario } from "./agendamentos";
import { hojeNoFuso } from "./agenda-visual";

export interface DiaDoEstabelecimento {
  /** `YYYY-MM-DD` pedido à API. */
  date: string;
  /** Fuso do estabelecimento, depois da primeira agenda; antes, `null`. */
  timezone: string | null;
  /** Escolha da pessoa: desliga o ajuste automático. */
  mudarData: (date: string) => void;
  /** "Hoje" no fuso do estabelecimento (ou do navegador, sem fuso ainda). */
  irParaHoje: () => void;
  /** Chamar a cada agenda recebida (ver o efeito em quem usa). */
  sincronizar: (agenda: Pick<AgendaDoDiaReal, "timezone" | "date">) => void;
}

export function useDiaDoEstabelecimento(tenantId: string | null): DiaDoEstabelecimento {
  // `useState` com inicializador: o "hoje" do navegador é lido UMA vez, como
  // ponto de partida editável. Quem interpreta a data no fuso do
  // estabelecimento é sempre o servidor.
  const [date, setDate] = useState(() => comoDataDeCalendario(new Date()));
  const [timezone, setTimezone] = useState<string | null>(null);
  /** A pessoa já escolheu um dia (ou o ajuste inicial já rodou). */
  const diaEscolhidoRef = useRef(false);

  // Outro estabelecimento pode ter outro fuso: o ajuste volta a valer.
  useEffect(() => {
    setTimezone(null);
    diaEscolhidoRef.current = false;
  }, [tenantId]);

  const mudarData = useCallback((nova: string) => {
    diaEscolhidoRef.current = true;
    setDate(nova);
  }, []);

  const irParaHoje = useCallback(() => {
    const hoje = timezone ? hojeNoFuso(timezone, new Date()) : null;
    diaEscolhidoRef.current = true;
    setDate(hoje ?? comoDataDeCalendario(new Date()));
  }, [timezone]);

  // Só fuso e data: a agenda do funcionário (outra rota) usa a mesma regra.
  const sincronizar = useCallback((agenda: Pick<AgendaDoDiaReal, "timezone" | "date">) => {
    setTimezone(agenda.timezone);
    if (diaEscolhidoRef.current) return;
    diaEscolhidoRef.current = true;
    const hoje = hojeNoFuso(agenda.timezone, new Date());
    if (hoje && hoje !== agenda.date) setDate(hoje);
  }, []);

  return { date, timezone, mudarData, irParaHoje, sincronizar };
}
