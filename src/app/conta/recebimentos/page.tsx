"use client";

// Recebimentos (dono): o registro manual do dinheiro que entrou por
// atendimento, que alimenta os números financeiros do Início.
//
// - Resumo do período (mesmo cálculo do Início, feito no servidor):
//   recebido, estornado, líquido e ticket médio.
// - Atendimentos concluídos no período sem recebimento, cada um com o
//   formulário de quitação.
// - Recebimentos do período (pela data do recebimento ou do estorno), com o
//   estorno.
//
// Concluir ou cancelar um atendimento não registra nem estorna nada aqui.
// Mensalidade do estabelecimento com a plataforma não tem relação com esta
// tela.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehRecebimentos } from "@/lib/api/recebimentos-api";
import { formatarMoeda } from "@/lib/format";
import { dataCurta, mesDe, rotuloDoPeriodo, type PeriodoLocal } from "@/lib/conta/inicio";
import { deslocar } from "@/lib/profissionais/calendario";
import { hojeNoFuso } from "@/lib/profissionais/agenda-visual";
import { ROTA_INICIO } from "@/lib/conta/rotas";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { ReautenticacaoProvider } from "@/components/administracao/reautenticacao";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ListaRecebimentos } from "./lista-recebimentos";
import { RegistrarRecebimento } from "./registrar-recebimento";

const MENSAGEM_DE_LEITURA = {
  sessao: "Sua sessão precisa ser verificada novamente. Entre de novo.",
  permissao: "Sua conta não pode ver os recebimentos deste estabelecimento.",
  ausente: "Estabelecimento não encontrado.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar os recebimentos.",
} as const;

/** Período inicial: o que veio do Início (`?de=&ate=`) ou o mês corrente. */
function periodoInicial(): PeriodoLocal {
  const busca = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const de = busca.get("de");
  const ate = busca.get("ate");
  if (de && ate && /^\d{4}-\d{2}-\d{2}$/.test(de) && /^\d{4}-\d{2}-\d{2}$/.test(ate) && de <= ate) return { from: de, to: ate };
  const agora = new Date();
  return mesDe(
    `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`,
  );
}

export default function RecebimentosPage() {
  const { estado: sessao } = useRealAuth();
  const { notificar } = useToast();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const [periodo, setPeriodo] = useState<PeriodoLocal | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);
  useEffect(() => setPeriodo(periodoInicial()), []);

  const { estado, recarregar, anterior } = useLeituraPlataforma(
    tenantId && periodo ? `/tenants/${encodeURIComponent(tenantId)}/payments?from=${periodo.from}&to=${periodo.to}` : null,
    ehRecebimentos,
  );
  const dados = estado.status === "pronto" ? estado.dados : anterior;
  if (sessao.status !== "autenticado" || !tenantId || !periodo) return null;
  const estabelecimento: string = tenantId;
  const hoje = (dados ? hojeNoFuso(dados.timezone, new Date()) : null) ?? periodo.to;

  function mudou(mensagem: string) {
    setQuitando(null);
    notificar(mensagem, "sucesso");
    recarregar();
  }

  return (
    <ReautenticacaoProvider>
      <PaginaConta
        titulo="Recebimentos"
        descricao="O dinheiro que entrou por atendimento, registrado por você. É daqui que vêm os valores do Início."
        voltar={{ href: ROTA_INICIO, rotulo: "Voltar ao Início" }}
        acoes={
          <Botao type="button" variante="secundaria" className="min-h-11" onClick={recarregar}>
            <RefreshCw size={16} aria-hidden="true" />
            Atualizar
          </Botao>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Botao type="button" variante="secundaria" aria-label="Mês anterior" onClick={() => setPeriodo(mesDe(deslocar("mes", periodo.from, -1)))}>
            <ChevronLeft size={16} aria-hidden="true" />
          </Botao>
          <p className="min-w-0 text-sm font-semibold text-ink" data-testid="periodo-recebimentos">
            {rotuloDoPeriodo(periodo)}
          </p>
          <Botao type="button" variante="secundaria" aria-label="Próximo mês" onClick={() => setPeriodo(mesDe(deslocar("mes", periodo.from, 1)))}>
            <ChevronRight size={16} aria-hidden="true" />
          </Botao>
        </div>

        {!dados && estado.status === "carregando" && <Skeleton className="h-40 w-full" />}
        {!dados && estado.status === "erro" && (
          <Cartao>
            <CartaoCorpo className="space-y-3">
              <p role="alert" className="text-sm text-ink">
                {MENSAGEM_DE_LEITURA[estado.motivo]}
              </p>
              <Botao type="button" onClick={recarregar}>
                Tentar novamente
              </Botao>
            </CartaoCorpo>
          </Cartao>
        )}

        {dados && (
          <>
            <section aria-label="Resumo do período" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="resumo-recebimentos">
              <Numero rotulo="Recebido no período" valor={formatarMoeda(dados.summary.receivedCents)} testId="resumo-recebido" />
              <Numero rotulo="Estornado no período" valor={formatarMoeda(dados.summary.refundedCents)} testId="resumo-estornado" />
              <Numero rotulo="Líquido" valor={formatarMoeda(dados.summary.netCents)} testId="resumo-liquido" />
              <Numero
                rotulo={`Ticket médio · ${dados.summary.paidAppointments} pago(s)`}
                valor={dados.summary.averageTicketCents === null ? "—" : formatarMoeda(dados.summary.averageTicketCents)}
                testId="resumo-ticket"
              />
            </section>

            <section aria-labelledby="titulo-a-quitar" className="space-y-3">
              <h2 id="titulo-a-quitar" className="text-base font-semibold text-ink">
                Concluídos sem recebimento
              </h2>
              {dados.awaitingPayment.length === 0 ? (
                <p className="text-sm text-ink-soft" data-testid="nada-a-quitar">
                  Nenhum atendimento concluído sem recebimento neste período.
                </p>
              ) : (
                <ul className="space-y-2" data-testid="a-quitar">
                  {dados.awaitingPayment.map((a) => (
                    <li key={a.id} className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4" data-testid="atendimento-a-quitar">
                      <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-semibold break-words text-ink">{a.consumerName}</p>
                          <p className="text-ink-soft">
                            {a.serviceName} · {a.professionalName} · {dataCurta(a.localDate)}
                          </p>
                        </div>
                        {quitando !== a.id && (
                          <Botao type="button" className="min-h-11" onClick={() => setQuitando(a.id)}>
                            Registrar recebimento
                          </Botao>
                        )}
                      </div>
                      {quitando === a.id && (
                        <RegistrarRecebimento
                          tenantId={estabelecimento}
                          atendimento={a}
                          hoje={hoje}
                          aoRegistrar={mudou}
                          aoCancelar={() => setQuitando(null)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!dados.awaitingComplete && <p className="text-xs text-ink-soft">Mostrando os mais recentes: o período tem mais atendimentos.</p>}
            </section>

            <section aria-labelledby="titulo-recebimentos" className="space-y-3">
              <h2 id="titulo-recebimentos" className="text-base font-semibold text-ink">
                Recebimentos e estornos do período
              </h2>
              <ListaRecebimentos tenantId={estabelecimento} recebimentos={dados.payments} aoMudar={mudou} />
              {!dados.paymentsComplete && <p className="text-xs text-ink-soft">Mostrando os mais recentes: o período tem mais registros.</p>}
            </section>

            <p className="text-xs text-ink-soft">
              Recebido: o que entrou no período (pela data do recebimento). Estornado: o que saiu no período (pela data
              do estorno, mesmo de um recebimento antigo). Ticket médio: soma dos recebimentos do período que não foram
              estornados ÷ quantidade desses atendimentos.
            </p>
          </>
        )}
      </PaginaConta>
    </ReautenticacaoProvider>
  );
}

function Numero({ rotulo, valor, testId }: { rotulo: string; valor: string; testId: string }) {
  return (
    <Cartao data-testid={testId}>
      <CartaoCorpo>
        <p className="text-xs font-medium text-ink-soft">{rotulo}</p>
        <p className="text-xl font-bold text-ink tabular-nums" data-testid={`${testId}-valor`}>
          {valor}
        </p>
      </CartaoCorpo>
    </Cartao>
  );
}
