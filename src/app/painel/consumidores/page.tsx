"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { useClientData } from "@/lib/hooks/use-client-data";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { agendamentoRepository, consumidorRepository, servicoRepository } from "@/lib/repositories";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { BadgeStatusAgendamento } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatarData, formatarHora, mascararWhatsapp } from "@/lib/format";

export default function PainelConsumidoresPage() {
  return (
    <RequirePermission permissao="consumidores.visualizar">
      <ConteudoConsumidores />
    </RequirePermission>
  );
}

function ConteudoConsumidores() {
  const { tenantId, terminologia } = useTenant();
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  const { dados, carregando } = useClientData(() => {
    const consumidores = consumidorRepository.listarPorTenant(tenantId).sort((a, b) => b.totalVisitas - a.totalVisitas);
    const agendamentos = agendamentoRepository.listarPorTenant(tenantId);
    const servicos = servicoRepository.listarPorTenant(tenantId);
    return { consumidores, agendamentos, nomeServico: new Map(servicos.map((s) => [s.id, s.nome])) };
  }, [tenantId]);

  if (carregando || !dados) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { consumidores, agendamentos, nomeServico } = dados;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{terminologia.consumidor.plural}</h1>
        <p className="text-sm text-ink-soft">
          Histórico resumido de quem já passou {terminologia.estabelecimento.artigo === "a" ? "pela" : "pelo"}{" "}
          {terminologia.estabelecimento.singular.toLowerCase()}.
        </p>
      </div>

      {consumidores.length === 0 ? (
        <EstadoVazio
          icone={Users}
          titulo={`Nenhum${terminologia.consumidor.artigo === "a" ? "a" : ""} ${terminologia.consumidor.singular.toLowerCase()} registrad${terminologia.consumidor.artigo === "a" ? "a" : "o"} ainda`}
        />
      ) : (
        <div className="space-y-2">
          {consumidores.map((consumidor) => {
            const expandido = expandidoId === consumidor.id;
            const historico = agendamentos
              .filter((a) => a.consumidorId === consumidor.id)
              .sort((a, b) => new Date(b.dataHoraInicio).getTime() - new Date(a.dataHoraInicio).getTime())
              .slice(0, 5);
            return (
              <Cartao key={consumidor.id}>
                <button
                  type="button"
                  onClick={() => setExpandidoId(expandido ? null : consumidor.id)}
                  className="flex w-full items-center gap-3 p-4 text-left"
                  aria-expanded={expandido}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{consumidor.nome}</p>
                    <p className="text-xs text-ink-soft">{mascararWhatsapp(consumidor.whatsapp)}</p>
                  </div>
                  <div className="hidden gap-6 text-center sm:flex">
                    <MiniEstatistica rotulo="Visitas" valor={consumidor.totalVisitas} />
                    <MiniEstatistica rotulo="Faltas" valor={consumidor.totalFaltas} />
                  </div>
                  <div className="shrink-0 text-right text-xs text-ink-soft">
                    {consumidor.proximoAgendamentoEm && <p>Próximo: {formatarData(consumidor.proximoAgendamentoEm)}</p>}
                    {consumidor.ultimoAtendimentoEm && <p>Último: {formatarData(consumidor.ultimoAtendimentoEm)}</p>}
                  </div>
                  {expandido ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {expandido && (
                  <CartaoCorpo className="border-t border-border pt-3">
                    <div className="mb-3 flex gap-6 text-sm sm:hidden">
                      <MiniEstatistica rotulo="Visitas" valor={consumidor.totalVisitas} />
                      <MiniEstatistica rotulo="Faltas" valor={consumidor.totalFaltas} />
                    </div>
                    {historico.length === 0 ? (
                      <p className="text-sm text-ink-soft">Sem agendamentos registrados.</p>
                    ) : (
                      <ul className="space-y-2">
                        {historico.map((a) => (
                          <li key={a.id} className="flex items-center justify-between text-sm">
                            <span className="text-ink">
                              {formatarData(a.dataHoraInicio)} {formatarHora(a.dataHoraInicio)} ·{" "}
                              {nomeServico.get(a.servicoId)}
                            </span>
                            <BadgeStatusAgendamento status={a.status} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </CartaoCorpo>
                )}
              </Cartao>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniEstatistica({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <p className="text-sm font-bold text-ink">{valor}</p>
      <p className="text-[11px] text-ink-soft">{rotulo}</p>
    </div>
  );
}
