"use client";

// Página PÚBLICA real de agendamento (Lote A) — fala só com as rotas
// `/public/:slug` do backend. Nada aqui importa a demonstração (`/[slug]`,
// repositórios locais) nem a área logada.
//
// Fluxo: serviço → profissional → dia e horário → nome e WhatsApp → enviar.
// O resultado é um PEDIDO: a tela diz "Aguardando confirmação do
// estabelecimento" e nunca o apresenta como atendimento confirmado.
//
// ENVIO HONESTO: a chave do envio é gerada quando o pedido muda e reusada em
// qualquer repetição. Sem resposta do servidor, o formulário trava e oferece
// "Verificar envio" (mesma chave: o servidor devolve o pedido já gravado ou
// grava agora, nunca dois). Nada é reenviado sozinho.
//
// LEITURAS (página e horários) usam a recuperação comum
// (lib/api/leitura-com-recuperacao.ts): se a hospedagem gratuita estiver
// acordando, a tela diz "Conectando ao servidor…" e tenta de novo sozinha,
// dentro do prazo. O envio do pedido nunca entra nessa repetição.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, CalendarCheck, RefreshCw } from "lucide-react";
import { ConectandoAoServidor } from "@/components/conexao/aviso-conexao";
import { enviarPedidoPublico, type FalhaPublica, type ReciboPedido } from "@/lib/api/public-booking-api";
import {
  dataBr,
  diasOferecidos,
  gerarChaveDeEnvio,
  mensagemFalhaPublica,
  precoTexto,
} from "@/lib/agendamento-publico/agendamento-publico";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CLASSE_OPCAO,
  Horarios,
  Moldura,
  OPCAO_ATIVA,
  OPCAO_INATIVA,
  Recibo,
  Secao,
} from "./componentes";
import { useHorariosPublicos, usePaginaPublica } from "./use-leituras-publicas";

type EstadoEnvio =
  | { status: "ocioso" }
  | { status: "enviando" }
  | { status: "falha"; falha: FalhaPublica }
  | { status: "recebido"; recibo: ReciboPedido };

export default function AgendarOnlinePage() {
  const { slug } = useParams<{ slug: string }>();
  const { estado, carregarPagina } = usePaginaPublica(slug);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ startAt: string; localStart: string } | null>(null);
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [envio, setEnvio] = useState<EstadoEnvio>({ status: "ocioso" });
  const [chave, setChave] = useState(() => gerarChaveDeEnvio());
  const [versaoHorarios, setVersaoHorarios] = useState(0);
  // Barreira síncrona contra clique duplo: o estado "enviando" só vale no
  // próximo render, e dois cliques no mesmo quadro passariam pelos dois.
  const emVoo = useRef(false);

  const pagina = estado.status === "pronta" ? estado.pagina : null;
  const dias = useMemo(
    () => (pagina ? diasOferecidos(pagina.establishment.timezone, new Date()) : []),
    [pagina],
  );
  const profissionaisDoServico = useMemo(
    () => (pagina && serviceId ? pagina.professionals.filter((p) => p.serviceIds.includes(serviceId)) : []),
    [pagina, serviceId],
  );

  // Qualquer mudança no que será pedido → pedido novo → chave nova.
  useEffect(() => {
    setChave(gerarChaveDeEnvio());
  }, [serviceId, professionalId, slot, nome, whatsapp]);

  const horarios = useHorariosPublicos(slug, { serviceId, professionalId, date }, versaoHorarios);

  const travado = envio.status === "enviando" || (envio.status === "falha" && envio.falha.tipo === "incerto");
  const podeEnviar = !!slot && nome.trim().length >= 2 && whatsapp.trim().length >= 10 && !travado;

  async function enviar(evento?: FormEvent) {
    evento?.preventDefault();
    if (!slot || !serviceId || !professionalId || emVoo.current) return;
    emVoo.current = true;
    setEnvio({ status: "enviando" });
    const r = await enviarPedidoPublico(slug, {
      serviceId,
      professionalId,
      startAt: slot.startAt,
      name: nome.trim(),
      whatsapp: whatsapp.trim(),
      idempotencyKey: chave,
    });
    emVoo.current = false;
    if (r.ok) {
      setEnvio({ status: "recebido", recibo: r.dados });
      return;
    }
    setEnvio({ status: "falha", falha: r.falha });
    if (r.falha.tipo === "conflito" || r.falha.tipo === "recusado") {
      // A agenda mudou: o horário escolhido sai, a lista é relida.
      setSlot(null);
      setVersaoHorarios((v) => v + 1);
    }
  }

  if (estado.status === "carregando") {
    return (
      <Moldura>
        {estado.fase ? (
          <Cartao>
            <CartaoCorpo>
              <ConectandoAoServidor conexao={estado.fase} />
            </CartaoCorpo>
          </Cartao>
        ) : (
          <>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </>
        )}
      </Moldura>
    );
  }

  if (estado.status === "falha") {
    return (
      <Moldura>
        <Cartao data-testid="pagina-publica-falha">
          <CartaoCorpo className="space-y-3">
            <p role="alert" className="flex items-start gap-2 text-sm text-ink">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              {mensagemFalhaPublica(estado.falha)}
            </p>
            {estado.falha.tipo !== "nao_encontrada" && (
              <Botao variante="secundaria" onClick={() => void carregarPagina()}>
                <RefreshCw size={16} aria-hidden="true" /> Tentar de novo
              </Botao>
            )}
          </CartaoCorpo>
        </Cartao>
      </Moldura>
    );
  }

  const { establishment, services } = estado.pagina;

  if (envio.status === "recebido") {
    return (
      <Moldura titulo={establishment.name}>
        <Recibo recibo={envio.recibo} />
      </Moldura>
    );
  }

  const servico = services.find((s) => s.id === serviceId) ?? null;

  return (
    <Moldura titulo={establishment.name} subtitulo="Agendamento online">
      {services.length === 0 ? (
        <Cartao data-testid="sem-servicos">
          <CartaoCorpo>
            <p className="text-sm text-ink-soft">
              Este estabelecimento ainda não tem serviços disponíveis para agendamento online.
            </p>
          </CartaoCorpo>
        </Cartao>
      ) : (
        <form onSubmit={(e) => void enviar(e)} className="space-y-6" noValidate>
          <fieldset disabled={travado} className="min-w-0 space-y-6">
            <Secao numero={1} titulo="Serviço">
              <div className="grid gap-2 sm:grid-cols-2" data-testid="lista-servicos-publicos">
                {services.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={serviceId === s.id}
                    onClick={() => {
                      setServiceId(s.id);
                      setProfessionalId(null);
                      setSlot(null);
                      setEnvio({ status: "ocioso" });
                    }}
                    className={clsx(CLASSE_OPCAO, serviceId === s.id ? OPCAO_ATIVA : OPCAO_INATIVA)}
                  >
                    <span className="block font-medium">{s.name}</span>
                    <span className="block text-xs text-ink-soft">
                      {s.durationMinutes} min
                      {precoTexto(s.priceCents, s.priceVisible) && ` · ${precoTexto(s.priceCents, s.priceVisible)}`}
                    </span>
                    {s.description && <span className="block text-xs text-ink-soft">{s.description}</span>}
                  </button>
                ))}
              </div>
            </Secao>

            {servico && (
              <Secao numero={2} titulo="Profissional">
                <div className="grid gap-2 sm:grid-cols-2" data-testid="lista-profissionais-publicos">
                  {profissionaisDoServico.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={professionalId === p.id}
                      onClick={() => {
                        setProfessionalId(p.id);
                        setSlot(null);
                        setDate((atual) => atual ?? dias[0]?.date ?? null);
                        setEnvio({ status: "ocioso" });
                      }}
                      className={clsx(CLASSE_OPCAO, "flex items-center gap-3", professionalId === p.id ? OPCAO_ATIVA : OPCAO_INATIVA)}
                    >
                      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-paper-muted text-xs font-semibold">
                        {p.initials}
                      </span>
                      {p.name}
                    </button>
                  ))}
                </div>
              </Secao>
            )}

            {servico && professionalId && (
              <Secao numero={3} titulo="Dia e horário">
                <p className="text-xs text-ink-soft">Horários no fuso do estabelecimento ({establishment.timezone}).</p>
                <div className="flex gap-2 overflow-x-auto pb-1" data-testid="lista-dias">
                  {dias.map((d) => (
                    <button
                      key={d.date}
                      type="button"
                      aria-pressed={date === d.date}
                      onClick={() => {
                        setDate(d.date);
                        setSlot(null);
                        setEnvio({ status: "ocioso" });
                      }}
                      className={clsx(CLASSE_OPCAO, "shrink-0 text-center", date === d.date ? OPCAO_ATIVA : OPCAO_INATIVA)}
                    >
                      {d.rotulo}
                    </button>
                  ))}
                </div>
                <Horarios
                  estado={horarios}
                  selecionado={slot?.startAt ?? null}
                  aoEscolher={(s) => {
                    setSlot(s);
                    setEnvio({ status: "ocioso" });
                  }}
                  aoTentarDeNovo={() => setVersaoHorarios((v) => v + 1)}
                />
              </Secao>
            )}

            {slot && (
              <Secao numero={4} titulo="Seus dados">
                <p className="text-xs text-ink-soft">
                  Não é preciso criar conta. O estabelecimento usa estes dados para responder ao seu pedido.
                </p>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-ink">Nome</span>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    autoComplete="name"
                    maxLength={80}
                    className="min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-card px-3 text-ink"
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-ink">WhatsApp com DDD</span>
                  <input
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={30}
                    placeholder="(11) 98765-4321"
                    className="min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-card px-3 text-ink"
                  />
                </label>
              </Secao>
            )}
          </fieldset>

          {envio.status === "falha" && (
            <div
              role="alert"
              data-testid={envio.falha.tipo === "incerto" ? "envio-incerto" : "envio-falha"}
              className="flex items-start gap-2 rounded-[var(--radius-control)] border border-border bg-paper-muted p-3 text-sm text-ink"
            >
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{mensagemFalhaPublica(envio.falha)}</span>
            </div>
          )}

          {slot && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {envio.status === "falha" && envio.falha.tipo === "incerto" ? (
                <Botao type="button" onClick={() => void enviar()} data-testid="verificar-envio">
                  <RefreshCw size={16} aria-hidden="true" /> Verificar envio
                </Botao>
              ) : (
                <Botao type="submit" disabled={!podeEnviar} data-testid="enviar-pedido">
                  <CalendarCheck size={16} aria-hidden="true" />
                  {envio.status === "enviando" ? "Enviando..." : `Pedir ${slot.localStart} em ${date ? dataBr(date) : ""}`}
                </Botao>
              )}
            </div>
          )}
        </form>
      )}
    </Moldura>
  );
}
