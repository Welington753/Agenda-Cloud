"use client";

// Agendamentos reais do estabelecimento (Lote 6D.5). Vive sob `/conta`, área
// REAL: nada de repositório, seed ou dado da demonstração entra aqui
// (auditado por lib/servicos/sem-dados-demo.test.ts).
//
// ESCOPO: criar, consultar, CANCELAR e REMARCAR (Lote 6D.6); CONFIRMAR,
// INICIAR, CONCLUIR e REGISTRAR FALTA (Lote 6D.7). Remarcar move só
// o horário da mesma reserva. Não há escolha livre de status nem exclusão:
// cada mudança de status é uma ação explícita, com destino fixo pela rota do
// backend. A lista do dia e as ações por reserva vivem em agenda-do-dia.tsx /
// acoes-reserva.tsx; o tratamento do resultado das ações, em
// use-acoes-da-agenda.ts.
//
// LAYOUT: a agenda do dia é o conteúdo principal, com a barra de data, filtro
// e Atualizar no topo (barra-agenda.tsx). A nova reserva abre sob demanda num
// painel (painel-nova-reserva.tsx) com o formulário de sempre.
//
// Fuso: a tela EXIBE as horas locais que o backend devolve
// (`localStart`/`localServiceEnd`) e nunca converte nada com o relógio do
// navegador. "Hoje" é calculado no fuso do ESTABELECIMENTO, que vem com a
// agenda; até a primeira resposta, o ponto de partida é o dia do navegador.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { useProfissionaisReais } from "@/lib/profissionais/use-profissionais-reais";
import { useAgendamentosReais } from "@/lib/profissionais/use-agendamentos-reais";
import { comoDataDeCalendario, mensagemFalhaAgendamento } from "@/lib/profissionais/agendamentos";
import {
  deslocarData,
  filtrarPorProfissional,
  hojeNoFuso,
  opcoesDeProfissional,
  resumoDoDia,
  rotuloDoResumo,
  TODOS_OS_PROFISSIONAIS,
} from "@/lib/profissionais/agenda-visual";
import type { AgendamentoReal, SelecaoDeCliente } from "@/lib/api/appointments-api";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { AgendaDoDia } from "./agenda-do-dia";
import { BarraAgenda } from "./barra-agenda";
import { PainelNovaReserva } from "./painel-nova-reserva";
import { ReservaCriada } from "./reserva-criada";
import { useAcoesDaAgenda } from "./use-acoes-da-agenda";

export default function AgendamentosPage() {
  const { estado: estadoSessao } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();

  const sessao = estadoSessao.status === "autenticado" ? estadoSessao.sessao : null;
  const tenantIdAtivo = estadoSessao.status === "autenticado" ? estadoSessao.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  // `useState` com inicializador: o "hoje" do navegador é lido UMA vez, como
  // ponto de partida editável. Quem interpreta a data no fuso do
  // estabelecimento é sempre o servidor.
  const [date, setDate] = useState(() => comoDataDeCalendario(new Date()));
  const [filtroProfissionalId, setFiltroProfissionalId] = useState(TODOS_OS_PROFISSIONAIS);
  const [painelAberto, setPainelAberto] = useState(false);
  const [erroReserva, setErroReserva] = useState<string | null>(null);
  const [ultimaReserva, setUltimaReserva] = useState<{
    reserva: AgendamentoReal;
    date: string;
  } | null>(null);
  /** Fuso do estabelecimento, conhecido depois da primeira agenda. */
  const [timezone, setTimezone] = useState<string | null>(null);
  /** A pessoa já escolheu um dia (ou o ajuste inicial já rodou): o ajuste
   * automático para o "hoje" do estabelecimento nunca passa por cima disso. */
  const diaEscolhidoRef = useRef(false);

  const agendamentos = useAgendamentosReais(tenantIdAtivo, date);
  const { estado, gravando, recarregar, criar } = agendamentos;
  const { erroAcao, setErroAcao, aoCancelar, aoAlterarStatus, aoRemarcar } = useAcoesDaAgenda(
    agendamentos,
    notificar,
  );
  const { estado: estadoProfissionais, recarregar: recarregarProfissionais } =
    useProfissionaisReais(tenantIdAtivo);

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  // Trocar de estabelecimento invalida o que está na tela: a última reserva,
  // os erros, o filtro (profissionais de outro contexto), o painel e o fuso.
  useEffect(() => {
    setUltimaReserva(null);
    setErroReserva(null);
    setErroAcao(null);
    setFiltroProfissionalId(TODOS_OS_PROFISSIONAIS);
    setPainelAberto(false);
    setTimezone(null);
    diaEscolhidoRef.current = false;
  }, [tenantIdAtivo, setErroAcao]);

  // Trocar de dia também invalida o erro de uma ação: ele falava de uma reserva
  // que não está mais na tela.
  useEffect(() => {
    setErroAcao(null);
  }, [date, setErroAcao]);

  const agenda = estado.status === "carregada" ? estado.agenda : null;

  // Primeira agenda do estabelecimento: guarda o fuso e, se a pessoa ainda não
  // escolheu um dia, troca o dia do navegador pelo "hoje" do estabelecimento
  // (os dois diferem perto da meia-noite ou com o navegador em outro fuso).
  useEffect(() => {
    if (!agenda) return;
    setTimezone(agenda.timezone);
    if (diaEscolhidoRef.current) return;
    diaEscolhidoRef.current = true;
    const hoje = hojeNoFuso(agenda.timezone, new Date());
    if (hoje && hoje !== agenda.date) setDate(hoje);
  }, [agenda]);

  const visiveis = useMemo(
    () => (agenda ? filtrarPorProfissional(agenda.appointments, filtroProfissionalId) : []),
    [agenda, filtroProfissionalId],
  );
  const opcoesFiltro = useMemo(
    () =>
      opcoesDeProfissional(
        estadoProfissionais.status === "carregada" ? estadoProfissionais.profissionais : [],
        agenda?.appointments ?? [],
      ),
    [estadoProfissionais, agenda],
  );

  if (!sessao || precisaSelecionar) return null;

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  if (!contexto || !tenantIdAtivo) {
    return (
      <Pagina titulo="Agendamentos">
        <Cartao>
          <CartaoCorpo className="flex items-start gap-3">
            <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
            <p className="text-sm text-ink-soft">
              Sua conta ainda não está vinculada a um estabelecimento.
            </p>
          </CartaoCorpo>
        </Cartao>
      </Pagina>
    );
  }

  function mudarData(nova: string) {
    diaEscolhidoRef.current = true;
    setDate(nova);
  }

  function irParaHoje() {
    const hoje = timezone ? hojeNoFuso(timezone, new Date()) : null;
    mudarData(hoje ?? comoDataDeCalendario(new Date()));
  }

  function abrirPainel() {
    setErroReserva(null);
    setPainelAberto(true);
  }

  async function aoConfirmar(dados: {
    professionalId: string;
    serviceId: string;
    startAt: string;
    consumer: SelecaoDeCliente;
  }): Promise<AgendamentoReal | null> {
    setErroReserva(null);
    const resultado = await criar(dados);

    if (resultado.ok) {
      // O painel fecha e o formulário é descartado: o que fica na tela é a
      // agenda (já recarregada pelo hook) com a reserva marcada e o aviso no
      // topo — nunca um formulário preenchido parecendo pendente.
      const criada = resultado.dados;
      setUltimaReserva({ reserva: criada, date });
      setPainelAberto(false);
      // Se o filtro esconderia a reserva criada, ele volta para todos.
      setFiltroProfissionalId((atual) =>
        atual === TODOS_OS_PROFISSIONAIS || atual === criada.professional.id
          ? atual
          : TODOS_OS_PROFISSIONAIS,
      );
      notificar("Agendamento confirmado.", "sucesso");
      return criada;
    }

    setErroReserva(mensagemFalhaAgendamento(resultado.falha));

    // 409: a agenda mudou entre a consulta e o envio — a lista do dia é
    // recarregada para a pessoa ver o que passou a ocupar o horário. Nunca
    // reenvia sozinho.
    if (resultado.falha.tipo === "horario_ocupado") {
      recarregar();
    }
    // Falha de comunicação NÃO recarrega automaticamente nem reenvia: a
    // mensagem orienta a conferir a agenda, e "Atualizar" faz isso quando a
    // pessoa decidir.
    return null;
  }

  return (
    <Pagina titulo="Agenda" subtitulo={contexto.tenantName}>
      <BarraAgenda
        date={date}
        timezone={timezone}
        ehHoje={!!timezone && hojeNoFuso(timezone, new Date()) === date}
        resumo={agenda ? rotuloDoResumo(resumoDoDia(visiveis)) : null}
        carregando={estado.status === "carregando"}
        profissionais={opcoesFiltro}
        filtroProfissionalId={filtroProfissionalId}
        aoMudarData={mudarData}
        aoAnterior={() => mudarData(deslocarData(date, -1))}
        aoProximo={() => mudarData(deslocarData(date, 1))}
        aoHoje={irParaHoje}
        aoFiltrar={setFiltroProfissionalId}
        aoAtualizar={recarregar}
        aoNovoAgendamento={abrirPainel}
      />

      {ultimaReserva && (
        <ReservaCriada
          reserva={ultimaReserva.reserva}
          date={ultimaReserva.date}
          aoDispensar={() => setUltimaReserva(null)}
        />
      )}

      <AgendaDoDia
        tenantId={tenantIdAtivo}
        estado={estado}
        agenda={agenda}
        gravando={gravando}
        erroAcao={erroAcao}
        filtroProfissionalId={filtroProfissionalId}
        recemCriadaId={ultimaReserva?.reserva.id ?? null}
        aoLimparFiltro={() => setFiltroProfissionalId(TODOS_OS_PROFISSIONAIS)}
        recarregar={recarregar}
        aoCancelar={aoCancelar}
        aoAlterarStatus={aoAlterarStatus}
        aoRemarcar={aoRemarcar}
      />

      <PainelNovaReserva
        aberto={painelAberto}
        aoFechar={() => setPainelAberto(false)}
        tenantId={tenantIdAtivo}
        date={date}
        aoMudarData={mudarData}
        estadoProfissionais={estadoProfissionais}
        recarregarProfissionais={recarregarProfissionais}
        profissionalInicialId={
          filtroProfissionalId === TODOS_OS_PROFISSIONAIS ? null : filtroProfissionalId
        }
        gravando={gravando}
        erro={erroReserva}
        aoConfirmar={aoConfirmar}
      />
    </Pagina>
  );
}

function Pagina({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:py-8">
      <div>
        <h1 className="text-xl font-bold text-ink">{titulo}</h1>
        {subtitulo && <p className="text-sm text-ink-soft">{subtitulo}</p>}
      </div>
      {children}
    </div>
  );
}
