"use client";

// Conteúdo das etapas "Serviço", "Dia e horário", "Seus dados" e "Revisar" da página
// pública (page.tsx guarda o estado e decide a etapa).
import { useId, type ReactNode } from "react";
import { AlertTriangle, CalendarCheck, ChevronRight, RefreshCw, Search } from "lucide-react";
import type { FalhaPublica, PaginaPublica } from "@/lib/api/public-booking-api";
import {
  dataPorExtenso,
  mensagemFalhaPublica,
  nomePlausivel,
  precoPublico,
  whatsappPlausivel,
  type DiaOferecido,
} from "@/lib/agendamento-publico/agendamento-publico";
import type { Escolhas, HorarioEscolhido } from "@/lib/agendamento-publico/fluxo-publico";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { CartaoServico, Dias, Horarios, type EstadoHorarios } from "./escolhas";
import { Resumo } from "./recibo";

const CLASSE_CAMPO =
  "min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-base text-ink placeholder:text-ink-muted focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/** Falha do envio, mostrada onde a pessoa pode agir: na escolha do horário
 * (conflito) ou na revisão (incerto, limite, página desativada). */
export function FalhaDoEnvio({ falha }: { falha: FalhaPublica }) {
  return (
    <div
      role="alert"
      data-testid={falha.tipo === "incerto" ? "envio-incerto" : "envio-falha"}
      className="flex items-start gap-2 rounded-[var(--radius-control)] border border-warning bg-warning-soft p-3 text-sm text-ink"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <span>{mensagemFalhaPublica(falha)}</span>
    </div>
  );
}

export function EtapaServico({
  servicos,
  comBusca,
  busca,
  aoBuscar,
  escolhido,
  aoEscolher,
}: {
  servicos: PaginaPublica["services"];
  comBusca: boolean;
  busca: string;
  aoBuscar: (termo: string) => void;
  escolhido: string | null;
  aoEscolher: (serviceId: string) => void;
}) {
  return (
    <section className="space-y-3" aria-label="Serviço">
      {comBusca && (
        <label className="relative block">
          <span className="sr-only">Buscar serviço pelo nome</span>
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
          <input
            type="search"
            value={busca}
            onChange={(e) => aoBuscar(e.target.value)}
            placeholder="Buscar serviço"
            enterKeyHint="search"
            autoComplete="off"
            data-testid="busca-servicos"
            className={`${CLASSE_CAMPO} pl-10`}
          />
        </label>
      )}
      <div className="grid gap-2 sm:grid-cols-2" data-testid="lista-servicos-publicos">
        {servicos.map((s) => (
          <CartaoServico key={s.id} servico={s} ativo={escolhido === s.id} aoEscolher={() => aoEscolher(s.id)} />
        ))}
      </div>
      {servicos.length === 0 && (
        <p role="status" className="text-sm text-ink-soft" data-testid="busca-sem-resultado">
          Nenhum serviço com esse nome.
        </p>
      )}
    </section>
  );
}

export function EtapaHorario({
  fuso,
  dias,
  escolhas,
  horarios,
  falhaDoEnvio,
  aoEscolherDia,
  aoEscolherHorario,
  aoTentarDeNovo,
  aoContinuar,
}: {
  fuso: string;
  dias: DiaOferecido[];
  escolhas: Escolhas;
  horarios: EstadoHorarios;
  falhaDoEnvio: ReactNode;
  aoEscolherDia: (date: string) => void;
  aoEscolherHorario: (slot: HorarioEscolhido) => void;
  aoTentarDeNovo: () => void;
  aoContinuar: () => void;
}) {
  const { date, slot } = escolhas;
  return (
    <section className="space-y-4" aria-label="Dia e horário">
      <p className="text-xs text-ink-soft" data-testid="fuso-estabelecimento">
        Dias e horários no fuso do estabelecimento: {fuso}.
      </p>
      <Dias dias={dias} selecionado={date} aoEscolher={aoEscolherDia} />
      {falhaDoEnvio}
      <Horarios
        estado={horarios}
        selecionado={slot?.startAt ?? null}
        aoEscolher={aoEscolherHorario}
        aoTentarDeNovo={aoTentarDeNovo}
      />
      {/* Barra presa ao fim da tela enquanto houver horários para rolar.
          `sticky`, não `fixed`: ocupa o próprio lugar no fim do conteúdo,
          então nunca cobre a última linha nem mensagens; e nesta etapa não
          há campo de texto (o teclado não abre). */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-paper px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-ink" aria-live="polite" data-testid="horario-escolhido">
            {slot && date ? (
              <>
                <span className="block text-xs text-ink-soft">Horário escolhido</span>
                <span className="font-semibold">
                  {dataPorExtenso(date)} às {slot.localStart}
                </span>
              </>
            ) : (
              <span className="text-ink-soft">Escolha um horário</span>
            )}
          </p>
          <Botao type="button" tamanho="lg" disabled={!slot} onClick={aoContinuar} data-testid="continuar-horario">
            Continuar <ChevronRight size={18} aria-hidden="true" />
          </Botao>
        </div>
      </div>
    </section>
  );
}

export function EtapaDados({
  nome,
  whatsapp,
  mostrarErros,
  aoMudarNome,
  aoMudarWhatsapp,
  aoRevisar,
}: {
  nome: string;
  whatsapp: string;
  mostrarErros: boolean;
  aoMudarNome: (v: string) => void;
  aoMudarWhatsapp: (v: string) => void;
  aoRevisar: () => void;
}) {
  const idWhatsapp = useId();
  const nomeInvalido = mostrarErros && !nomePlausivel(nome);
  const whatsappInvalido = mostrarErros && !whatsappPlausivel(whatsapp);
  return (
    <section className="space-y-4" aria-label="Seus dados">
      <p className="text-sm text-ink-soft">
        Não é preciso criar conta. O estabelecimento usa estes dados para responder à sua solicitação.
      </p>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-ink">Nome</span>
        <input
          value={nome}
          onChange={(e) => aoMudarNome(e.target.value)}
          onKeyDown={(e) => {
            // "Próximo" do teclado do celular: vai para o WhatsApp.
            if (e.key !== "Enter") return;
            e.preventDefault();
            document.getElementById(idWhatsapp)?.focus();
          }}
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          maxLength={80}
          aria-invalid={nomeInvalido || undefined}
          aria-describedby={nomeInvalido ? "erro-nome" : undefined}
          className={CLASSE_CAMPO}
        />
        {nomeInvalido && (
          <span id="erro-nome" className="block text-sm text-danger">
            Informe seu nome.
          </span>
        )}
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-ink">WhatsApp com DDD</span>
        <input
          id={idWhatsapp}
          type="tel"
          value={whatsapp}
          onChange={(e) => aoMudarWhatsapp(e.target.value)}
          inputMode="tel"
          autoComplete="tel-national"
          enterKeyHint="done"
          maxLength={30}
          placeholder="(11) 98765-4321"
          aria-invalid={whatsappInvalido || undefined}
          aria-describedby={whatsappInvalido ? "erro-whatsapp" : undefined}
          className={CLASSE_CAMPO}
        />
        {whatsappInvalido && (
          <span id="erro-whatsapp" className="block text-sm text-danger">
            Informe o número com DDD, por exemplo (11) 98765-4321.
          </span>
        )}
      </label>
      <Botao type="button" tamanho="lg" className="w-full sm:w-auto" onClick={aoRevisar} data-testid="revisar-pedido">
        Revisar solicitação <ChevronRight size={18} aria-hidden="true" />
      </Botao>
    </section>
  );
}

export function EtapaRevisar({
  estabelecimento,
  servico,
  profissional,
  date,
  slot,
  fuso,
  nome,
  whatsapp,
  falhaDoEnvio,
  incerto,
  enviando,
  aoVerificar,
}: {
  estabelecimento: string;
  servico: PaginaPublica["services"][number];
  profissional: string;
  date: string;
  slot: HorarioEscolhido;
  fuso: string;
  nome: string;
  whatsapp: string;
  falhaDoEnvio: ReactNode;
  incerto: boolean;
  enviando: boolean;
  aoVerificar: () => void;
}) {
  return (
    <section className="space-y-4" aria-label="Revisar">
      <Cartao>
        <CartaoCorpo className="py-2 sm:py-3">
          <Resumo
            testId="resumo-pedido"
            linhas={[
              { rotulo: "Estabelecimento", valor: estabelecimento, testId: "resumo-estabelecimento" },
              { rotulo: "Serviço", valor: `${servico.name} · ${servico.durationMinutes} min`, testId: "resumo-servico" },
              { rotulo: "Profissional", valor: profissional, testId: "resumo-profissional" },
              { rotulo: "Data", valor: dataPorExtenso(date), testId: "resumo-data" },
              {
                rotulo: "Horário",
                valor: (
                  <>
                    {slot.localStart}
                    <span className="block text-xs font-normal text-ink-soft">{fuso}</span>
                  </>
                ),
                testId: "resumo-hora",
              },
              { rotulo: "Preço", valor: precoPublico(servico.priceCents, servico.priceVisible), testId: "resumo-preco" },
              { rotulo: "Nome", valor: nome.trim(), testId: "resumo-nome" },
              { rotulo: "WhatsApp", valor: whatsapp.trim(), testId: "resumo-whatsapp" },
            ]}
          />
        </CartaoCorpo>
      </Cartao>
      <p className="text-sm text-ink-soft">
        Ao enviar, o estabelecimento recebe sua solicitação e responde pelo contato informado. Até essa confirmação,
        não é um agendamento confirmado.
      </p>
      {falhaDoEnvio}
      {incerto ? (
        <Botao type="button" tamanho="lg" className="w-full sm:w-auto" onClick={aoVerificar} data-testid="verificar-envio">
          <RefreshCw size={18} aria-hidden="true" /> Verificar envio
        </Botao>
      ) : (
        <Botao
          type="submit"
          tamanho="lg"
          className="w-full sm:w-auto"
          disabled={enviando}
          aria-busy={enviando}
          data-testid="enviar-pedido"
        >
          <CalendarCheck size={18} aria-hidden="true" />
          {enviando ? "Enviando..." : "Solicitar agendamento"}
        </Botao>
      )}
    </section>
  );
}
