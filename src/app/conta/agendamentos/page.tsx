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
// painel (painel-nova-reserva.tsx) com o formulário de sempre. A lista do dia
// pode ser vista como "Lista" (inicial) ou "Por profissional"
// (alternar-visualizacao.tsx) — mesma consulta, só a apresentação muda.
//
// Fuso: a tela EXIBE as horas locais que o backend devolve
// (`localStart`/`localServiceEnd`) e nunca converte nada com o relógio do
// navegador. "Hoje" é calculado no fuso do ESTABELECIMENTO, que vem com a
// agenda (regra em lib/profissionais/use-dia-do-estabelecimento.ts, a mesma da
// Visão geral).
//
// `?novo=1` (atalho da Visão geral) abre o painel de nova reserva ao chegar —
// o formulário é sempre este, nunca uma cópia em outra tela.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Store } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { useProfissionaisReais } from "@/lib/profissionais/use-profissionais-reais";
import { useAgendamentosReais } from "@/lib/profissionais/use-agendamentos-reais";
import { mensagemFalhaAgendamento } from "@/lib/profissionais/agendamentos";
import { useDiaDoEstabelecimento } from "@/lib/profissionais/use-dia-do-estabelecimento";
import {
  deslocarData,
  filtrarPorProfissional,
  hojeNoFuso,
  opcoesDeProfissional,
  resumoDoDia,
  rotuloDoResumo,
  TODOS_OS_PROFISSIONAIS,
  type VisualizacaoAgenda,
} from "@/lib/profissionais/agenda-visual";
import type { AgendamentoReal, SelecaoDeCliente } from "@/lib/api/appointments-api";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { useToast } from "@/components/ui/toast";
import { AgendaDoDia } from "./agenda-do-dia";
import { AlternarVisualizacao } from "./alternar-visualizacao";
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

  const dia = useDiaDoEstabelecimento(tenantIdAtivo);
  const { date, timezone, mudarData, irParaHoje, sincronizar } = dia;
  const [filtroProfissionalId, setFiltroProfissionalId] = useState(TODOS_OS_PROFISSIONAIS);
  const [visualizacao, setVisualizacao] = useState<VisualizacaoAgenda>("lista");
  const [painelAberto, setPainelAberto] = useState(false);
  const [erroReserva, setErroReserva] = useState<string | null>(null);
  const [ultimaReserva, setUltimaReserva] = useState<{
    reserva: AgendamentoReal;
    date: string;
  } | null>(null);
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
  // os erros, o filtro (profissionais de outro contexto) e o painel. O fuso e
  // o ajuste de "hoje" são zerados pelo próprio useDiaDoEstabelecimento.
  useEffect(() => {
    setUltimaReserva(null);
    setErroReserva(null);
    setErroAcao(null);
    setFiltroProfissionalId(TODOS_OS_PROFISSIONAIS);
    setPainelAberto(false);
  }, [tenantIdAtivo, setErroAcao]);

  // Atalho "Novo agendamento" da Visão geral: abre o painel uma vez e limpa o
  // parâmetro, para recarregar a página não reabrir o formulário. Lido do
  // `window` (e não de useSearchParams) porque só importa na chegada.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("novo") !== "1") return;
    setPainelAberto(true);
    router.replace("/conta/agendamentos");
  }, [router]);

  // Trocar de dia também invalida o erro de uma ação: ele falava de uma reserva
  // que não está mais na tela.
  useEffect(() => {
    setErroAcao(null);
  }, [date, setErroAcao]);

  const agenda = estado.status === "carregada" ? estado.agenda : null;

  // Cada agenda recebida informa o fuso; a primeira também ajusta "hoje".
  useEffect(() => {
    if (agenda) sincronizar(agenda);
  }, [agenda, sincronizar]);

  const visiveis = useMemo(
    () => (agenda ? filtrarPorProfissional(agenda.appointments, filtroProfissionalId) : []),
    [agenda, filtroProfissionalId],
  );
  const catalogo = useMemo(
    () => (estadoProfissionais.status === "carregada" ? estadoProfissionais.profissionais : []),
    [estadoProfissionais],
  );
  const opcoesFiltro = useMemo(
    () => opcoesDeProfissional(catalogo, agenda?.appointments ?? []),
    [catalogo, agenda],
  );

  if (!sessao || precisaSelecionar) return null;

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  if (!contexto || !tenantIdAtivo) {
    return (
      <PaginaConta titulo="Agenda">
        <Cartao>
          <CartaoCorpo className="flex items-start gap-3">
            <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
            <p className="text-sm text-ink-soft">
              Sua conta ainda não está vinculada a um estabelecimento.
            </p>
          </CartaoCorpo>
        </Cartao>
      </PaginaConta>
    );
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
    <PaginaConta titulo="Agenda" descricao="Quem será atendido, quando, por quem e qual serviço.">
      <BarraAgenda
        date={date}
        timezone={timezone}
        ehHoje={!!timezone && hojeNoFuso(timezone, new Date()) === date}
        resumo={agenda?.completa ? rotuloDoResumo(resumoDoDia(visiveis)) : null}
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

      {agenda && !agenda.completa && (
        <p
          role="note"
          data-testid="agenda-incompleta"
          className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          Este dia tem mais reservas do que a agenda consegue trazer de uma vez: a lista abaixo pode
          estar incompleta.
        </p>
      )}

      <AlternarVisualizacao valor={visualizacao} aoMudar={setVisualizacao} />

      <AgendaDoDia
        tenantId={tenantIdAtivo}
        estabelecimento={contexto.tenantName}
        estado={estado}
        agenda={agenda}
        gravando={gravando}
        erroAcao={erroAcao}
        filtroProfissionalId={filtroProfissionalId}
        visualizacao={visualizacao}
        profissionais={catalogo}
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
    </PaginaConta>
  );
}
