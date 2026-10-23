"use client";

// Página PÚBLICA real de agendamento (Lote A) — fala só com as rotas
// `/public/:slug` do backend. Nada aqui importa a demonstração (`/[slug]`,
// repositórios locais) nem a área logada.
//
// Percurso em etapas (regras em lib/agendamento-publico/fluxo-publico.ts):
// Serviço → Profissional → Dia e horário → Seus dados → Revisar. Voltar
// mantém o que continua válido; trocar serviço, profissional ou dia derruba
// o que deixou de valer e a disponibilidade é consultada de novo.
// O resultado é um PEDIDO: a tela diz "Solicitação enviada — aguardando
// confirmação" e nunca o apresenta como atendimento confirmado.
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
import { AlertTriangle, RefreshCw } from "lucide-react";
import { ConectandoAoServidor } from "@/components/conexao/aviso-conexao";
import { enviarPedidoPublico, type FalhaPublica, type PaginaPublica, type ReciboPedido } from "@/lib/api/public-booking-api";
import {
  BUSCA_A_PARTIR_DE,
  dataPorExtenso,
  diasOferecidos,
  filtrarServicos,
  gerarChaveDeEnvio,
  mensagemFalhaPublica,
  nomeDoFuso,
  nomePlausivel,
  precoPublico,
  whatsappPlausivel,
} from "@/lib/agendamento-publico/agendamento-publico";
import {
  ESCOLHAS_VAZIAS,
  ETAPA_DADOS,
  ETAPA_HORARIO,
  ETAPA_PROFISSIONAL,
  ETAPA_REVISAR,
  ETAPA_SERVICO,
  conferirHorario,
  escolherDia,
  escolherProfissional,
  escolherServico,
  etapaAnterior,
  etapaMaxima,
  profissionaisDoServico,
  type Escolhas,
  type Etapa,
} from "@/lib/agendamento-publico/fluxo-publico";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EtapaProfissional } from "./escolhas";
import { EtapaDados, EtapaHorario, EtapaRevisar, EtapaServico, FalhaDoEnvio } from "./etapas";
import { CabecalhoEtapa, Moldura, Progresso } from "./moldura";
import { Recibo } from "./recibo";
import { useHorariosPublicos, usePaginaPublica } from "./use-leituras-publicas";

type EstadoEnvio =
  | { status: "ocioso" }
  | { status: "enviando" }
  | { status: "falha"; falha: FalhaPublica }
  | { status: "recebido"; recibo: ReciboPedido };

export default function AgendarOnlinePage() {
  const { slug } = useParams<{ slug: string }>();
  const { estado, carregarPagina } = usePaginaPublica(slug);

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
            <Skeleton className="h-12 w-2/3" />
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

  return <Agendamento slug={slug} pagina={estado.pagina} />;
}

function Agendamento({ slug, pagina }: { slug: string; pagina: PaginaPublica }) {
  const { establishment, services } = pagina;
  const [escolhas, setEscolhas] = useState<Escolhas>(ESCOLHAS_VAZIAS);
  const [etapa, setEtapa] = useState<Etapa>(ETAPA_SERVICO);
  const [busca, setBusca] = useState("");
  const [tentouContinuar, setTentouContinuar] = useState(false);
  const [envio, setEnvio] = useState<EstadoEnvio>({ status: "ocioso" });
  const [chave, setChave] = useState(() => gerarChaveDeEnvio());
  const [versaoHorarios, setVersaoHorarios] = useState(0);
  // Barreira síncrona contra clique duplo: o estado "enviando" só vale no
  // próximo render, e dois cliques no mesmo quadro passariam pelos dois.
  const emVoo = useRef(false);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const primeiraEtapa = useRef(true);

  const { serviceId, professionalId, date, slot, nome, whatsapp } = escolhas;
  const dias = useMemo(() => diasOferecidos(establishment.timezone, new Date()), [establishment.timezone]);
  const fuso = useMemo(() => nomeDoFuso(establishment.timezone, new Date()), [establishment.timezone]);
  const opcoesProfissional = useMemo(() => profissionaisDoServico(pagina, serviceId), [pagina, serviceId]);
  const servico = services.find((s) => s.id === serviceId) ?? null;
  const profissional = opcoesProfissional.find((p) => p.id === professionalId) ?? null;
  const servicosVisiveis = useMemo(() => filtrarServicos(services, busca), [services, busca]);

  // Qualquer mudança no que será pedido → pedido novo → chave nova.
  useEffect(() => {
    setChave(gerarChaveDeEnvio());
  }, [serviceId, professionalId, slot, nome, whatsapp]);

  const horarios = useHorariosPublicos(slug, { serviceId, professionalId, date }, versaoHorarios);

  // Lista nova de horários sem o escolhido (ocupado nesse meio-tempo): cai.
  const livres = horarios.status === "pronto" ? horarios.horarios.slots : null;
  useEffect(() => {
    if (livres) setEscolhas((atual) => conferirHorario(atual, livres));
  }, [livres]);

  // Trocar de etapa leva o foco (e a rolagem) ao título dela.
  useEffect(() => {
    if (primeiraEtapa.current) {
      primeiraEtapa.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    tituloRef.current?.focus({ preventScroll: true });
  }, [etapa]);

  const travado = envio.status === "enviando" || (envio.status === "falha" && envio.falha.tipo === "incerto");
  const maxima = etapaMaxima(pagina, escolhas);

  function irPara(destino: Etapa) {
    if (travado) return;
    setTentouContinuar(false);
    setEtapa(destino <= maxima ? destino : maxima);
  }

  function alterar(novas: Escolhas) {
    setEscolhas(novas);
    if (envio.status === "falha") setEnvio({ status: "ocioso" });
  }

  function revisar() {
    setTentouContinuar(true);
    if (nomePlausivel(nome) && whatsappPlausivel(whatsapp)) irPara(ETAPA_REVISAR);
  }

  // Enter num campo envia o formulário pelo navegador: só na revisão isso
  // vira o pedido; em "Seus dados" equivale a "Revisar"; nas demais, nada.
  function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    if (etapa === ETAPA_REVISAR) void enviar();
    else if (etapa === ETAPA_DADOS) revisar();
  }

  async function enviar() {
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
      // A agenda mudou: o horário escolhido sai, a lista é relida e a pessoa
      // volta à escolha do horário, onde a mensagem aparece.
      setEscolhas((atual) => ({ ...atual, slot: null }));
      setVersaoHorarios((v) => v + 1);
      setEtapa(ETAPA_HORARIO);
    }
  }

  if (envio.status === "recebido") {
    return (
      <Moldura estabelecimento={establishment.name}>
        <Recibo
          recibo={envio.recibo}
          preco={servico ? precoPublico(servico.priceCents, servico.priceVisible) : null}
          nome={nome.trim()}
          whatsapp={whatsapp.trim()}
        />
      </Moldura>
    );
  }

  if (services.length === 0) {
    return (
      <Moldura estabelecimento={establishment.name}>
        <Cartao data-testid="sem-servicos">
          <CartaoCorpo>
            <p className="text-sm text-ink-soft">
              Este estabelecimento ainda não tem serviços disponíveis para agendamento online.
            </p>
          </CartaoCorpo>
        </Cartao>
      </Moldura>
    );
  }

  return (
    <Moldura estabelecimento={establishment.name}>
      <Progresso etapa={etapa} />
      <form onSubmit={aoSubmeter} className="space-y-4" noValidate>
        <CabecalhoEtapa
          ref={tituloRef}
          titulo={TITULO_DA_ETAPA[etapa]}
          aoVoltar={etapa > ETAPA_SERVICO ? () => irPara(etapaAnterior(etapa)) : null}
          travado={travado}
          servico={etapa > ETAPA_SERVICO && etapa < ETAPA_REVISAR ? (servico?.name ?? null) : null}
          profissional={etapa > ETAPA_PROFISSIONAL ? (profissional?.name ?? null) : null}
          quando={etapa > ETAPA_HORARIO && slot && date ? `${dataPorExtenso(date)} às ${slot.localStart}` : null}
        />

        {etapa === ETAPA_SERVICO && (
          <EtapaServico
            servicos={servicosVisiveis}
            comBusca={services.length >= BUSCA_A_PARTIR_DE}
            busca={busca}
            aoBuscar={setBusca}
            escolhido={serviceId}
            aoEscolher={(id) => {
              alterar(escolherServico(pagina, escolhas, id, dias[0]?.date ?? null));
              setEtapa(ETAPA_PROFISSIONAL);
            }}
          />
        )}

        {etapa === ETAPA_PROFISSIONAL && (
          <EtapaProfissional
            opcoes={opcoesProfissional}
            escolhido={profissional?.id ?? null}
            aoEscolher={(id) => {
              alterar(escolherProfissional(escolhas, id, dias[0]?.date ?? null));
              setEtapa(ETAPA_HORARIO);
            }}
            aoContinuar={() => irPara(ETAPA_HORARIO)}
          />
        )}

        {etapa === ETAPA_HORARIO && (
          <EtapaHorario
            fuso={fuso}
            dias={dias}
            escolhas={escolhas}
            horarios={horarios}
            falhaDoEnvio={envio.status === "falha" ? <FalhaDoEnvio falha={envio.falha} /> : null}
            aoEscolherDia={(d) => alterar(escolherDia(escolhas, d))}
            aoEscolherHorario={(s) => alterar({ ...escolhas, slot: s })}
            aoTentarDeNovo={() => setVersaoHorarios((v) => v + 1)}
            aoContinuar={() => irPara(ETAPA_DADOS)}
          />
        )}

        {etapa === ETAPA_DADOS && (
          <EtapaDados
            nome={nome}
            whatsapp={whatsapp}
            mostrarErros={tentouContinuar}
            aoMudarNome={(v) => alterar({ ...escolhas, nome: v })}
            aoMudarWhatsapp={(v) => alterar({ ...escolhas, whatsapp: v })}
            aoRevisar={revisar}
          />
        )}

        {etapa === ETAPA_REVISAR && servico && profissional && slot && date && (
          <EtapaRevisar
            estabelecimento={establishment.name}
            servico={servico}
            profissional={profissional.name}
            date={date}
            slot={slot}
            fuso={fuso}
            nome={nome}
            whatsapp={whatsapp}
            falhaDoEnvio={envio.status === "falha" ? <FalhaDoEnvio falha={envio.falha} /> : null}
            incerto={envio.status === "falha" && envio.falha.tipo === "incerto"}
            enviando={envio.status === "enviando"}
            aoVerificar={() => void enviar()}
          />
        )}
      </form>
    </Moldura>
  );
}

const TITULO_DA_ETAPA: Record<Etapa, string> = {
  0: "Escolha o serviço",
  1: "Escolha o profissional",
  2: "Escolha o dia e o horário",
  3: "Seus dados",
  4: "Revise e envie",
};
