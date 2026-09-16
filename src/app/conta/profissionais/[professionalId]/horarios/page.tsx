"use client";

// Horários semanais reais de um profissional (Lote 6D.3). Vive sob `/conta`,
// área REAL: nada de repositório, seed ou dado da demonstração entra aqui
// (auditado por lib/servicos/sem-dados-demo.test.ts, que varre `src/app/conta`
// e `src/lib/profissionais`).
//
// Fuso: a tela EXIBE o fuso que o backend devolve (`tenants.timezone`) e
// nunca converte nada com o relógio do navegador — os horários são hora local
// recorrente do estabelecimento.
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Store } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { useProfissionaisReais } from "@/lib/profissionais/use-profissionais-reais";
import { useHorariosReais } from "@/lib/profissionais/use-horarios-reais";
import { mensagemFalhaProfissionais } from "@/lib/profissionais/mensagens";
import {
  paraSemanaEditavel,
  validarSemana,
  type ErroDeCampo,
  type SemanaEditavel,
} from "@/lib/profissionais/horarios";
import type { IntervaloReal } from "@/lib/api/working-hours-api";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { EditorSemana } from "./editor-semana";

export default function HorariosDoProfissionalPage() {
  const { estado: estadoSessao } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();
  const params = useParams<{ professionalId: string }>();
  const professionalId = params.professionalId;

  const sessao = estadoSessao.status === "autenticado" ? estadoSessao.sessao : null;
  const tenantIdAtivo = estadoSessao.status === "autenticado" ? estadoSessao.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  const { estado, gravando, recarregar, salvar } = useHorariosReais(tenantIdAtivo, professionalId);
  // Só para exibir de quem é a agenda — reutiliza a listagem real já existente.
  const { estado: estadoProfissionais } = useProfissionaisReais(tenantIdAtivo);

  const [semana, setSemana] = useState<SemanaEditavel | null>(null);
  const [errosDeCampo, setErrosDeCampo] = useState<Record<number, ErroDeCampo[]>>({});
  const [erroDoDia, setErroDoDia] = useState<Record<number, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  // Carregou (ou recarregou, ou trocou de contexto): o rascunho local é
  // substituído pelo que veio do servidor — nunca mistura semana antiga com
  // profissional novo.
  useEffect(() => {
    if (estado.status === "carregada") {
      setSemana(paraSemanaEditavel(estado.horarios.days));
      setErrosDeCampo({});
      setErroDoDia({});
      setErroGeral(null);
    } else {
      setSemana(null);
    }
  }, [estado]);

  if (!sessao || precisaSelecionar) return null;

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  if (!contexto) {
    return (
      <Pagina titulo="Horários de trabalho">
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

  const profissional =
    estadoProfissionais.status === "carregada"
      ? estadoProfissionais.profissionais.find((p) => p.id === professionalId)
      : undefined;

  function alterarDia(weekday: number, intervals: IntervaloReal[]) {
    setSemana((atual) => (atual ? { ...atual, [weekday]: intervals } : atual));
  }

  async function aoSalvar(evento: React.FormEvent) {
    evento.preventDefault();
    // Segunda barreira contra envio duplicado, além do `disabled` do botão:
    // um clique já despachado antes do re-render nunca dispara um segundo PUT.
    if (!semana || gravando) return;

    const validacao = validarSemana(semana);
    setErrosDeCampo(validacao.errosDeCampo);
    setErroDoDia(validacao.erroDoDia);
    if (!validacao.ok) {
      setErroGeral("Revise os horários destacados.");
      return;
    }
    setErroGeral(null);

    const resultado = await salvar(validacao.days);
    if (!resultado.ok) {
      // Nunca reenvia sozinho: a mensagem fica e a pessoa decide.
      setErroGeral(mensagemFalhaProfissionais(resultado.falha));
      return;
    }
    notificar("Horários salvos.", "sucesso");
  }

  return (
    <Pagina
      titulo="Horários de trabalho"
      subtitulo={profissional ? `${profissional.name} · ${contexto.tenantName}` : contexto.tenantName}
    >
      {estado.status === "carregando" && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {estado.status === "falha" && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <p role="alert" className="text-sm text-ink">
              {mensagemFalhaProfissionais(estado.falha)}
            </p>
            {estado.falha.tipo !== "sem_permissao" && (
              <Botao type="button" onClick={recarregar}>
                Tentar novamente
              </Botao>
            )}
          </CartaoCorpo>
        </Cartao>
      )}

      {estado.status === "carregada" && semana && (
        <>
          <Cartao>
            <CartaoCorpo className="flex items-start gap-3">
              <Clock size={18} className="mt-0.5 shrink-0 text-ink-soft" />
              <div>
                <p className="text-sm text-ink">
                  Horários no fuso do estabelecimento:{" "}
                  <strong className="font-semibold">{estado.horarios.timezone}</strong>
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  Dia sem intervalo é dia sem atendimento. Cada dia aceita um período de trabalho e
                  uma pausa.
                </p>
              </div>
            </CartaoCorpo>
          </Cartao>

          {/* Form de verdade: o botão de salvar é o `submit`, então Enter
              também grava e o estado de envio fica preso a um só lugar. */}
          <form onSubmit={(evento) => void aoSalvar(evento)} className="space-y-6" noValidate>
            <EditorSemana
              semana={semana}
              errosDeCampo={errosDeCampo}
              erroDoDia={erroDoDia}
              desabilitado={gravando}
              aoAlterar={alterarDia}
            />

            {erroGeral && (
              <p role="alert" className="text-sm text-[color:var(--color-danger)]">
                {erroGeral}
              </p>
            )}

            <div className="flex gap-2">
              <Botao type="submit" disabled={gravando} aria-busy={gravando}>
                {gravando ? "Salvando..." : "Salvar horários"}
              </Botao>
              <Botao
                type="button"
                variante="secundaria"
                disabled={gravando}
                onClick={() => router.push("/conta/profissionais")}
              >
                Voltar para profissionais
              </Botao>
            </div>
          </form>
        </>
      )}
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
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
      <div>
        <Link href="/conta/profissionais" className="text-xs font-medium text-accent hover:underline">
          <ArrowLeft size={12} className="mr-1 inline" />
          Voltar para profissionais
        </Link>
        <h1 className="mt-2 text-xl font-bold text-ink">{titulo}</h1>
        {subtitulo && <p className="text-sm text-ink-soft">{subtitulo}</p>}
      </div>
      {children}
    </div>
  );
}
