"use client";

import { useMemo, useState } from "react";
import { Percent } from "lucide-react";
import { useClientData } from "@/lib/hooks/use-client-data";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { comissaoRegraRepository, lancamentoComissaoRepository, profissionalRepository, servicoRepository } from "@/lib/repositories";
import { calcularComissao, calcularTotaisRelatorio, validarRegraComissao } from "@/lib/comissoes/engine";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatarData, formatarMoeda } from "@/lib/format";
import type { RegraComissao, StatusLancamentoComissao, TipoComissao } from "@/lib/types";

export default function PainelComissoesPage() {
  return (
    <RequirePermission permissao="comissoes.visualizar">
      <ConteudoComissoes />
    </RequirePermission>
  );
}

function ConteudoComissoes() {
  const { tenantId, podeAcessar } = useTenant();
  const { notificar } = useToast();
  const podeGerenciar = podeAcessar("comissoes.gerenciar").permitido;

  const [profissionalSelecionadoId, setProfissionalSelecionadoId] = useState("");
  const [filtroProfissionalId, setFiltroProfissionalId] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState<StatusLancamentoComissao | "todos">("todos");
  const [filtroInicio, setFiltroInicio] = useState("");
  const [filtroFim, setFiltroFim] = useState("");

  const { dados, carregando, recarregar } = useClientData(
    () => ({
      profissionais: profissionalRepository.listarPorTenant(tenantId).filter((p) => p.ativo),
      servicos: servicoRepository.listarPorTenant(tenantId),
      regras: comissaoRegraRepository.listarPorTenant(tenantId),
      lancamentos: lancamentoComissaoRepository.listarPorTenant(tenantId),
    }),
    [tenantId]
  );

  const lancamentosFiltrados = useMemo(() => {
    if (!dados) return [];
    return dados.lancamentos.filter((l) => {
      if (filtroProfissionalId !== "todos" && l.profissionalId !== filtroProfissionalId) return false;
      if (filtroStatus !== "todos" && l.status !== filtroStatus) return false;
      if (filtroInicio && l.dataAtendimento < filtroInicio) return false;
      if (filtroFim && l.dataAtendimento > `${filtroFim}T23:59:59.999Z`) return false;
      return true;
    });
  }, [dados, filtroProfissionalId, filtroStatus, filtroInicio, filtroFim]);

  const totais = useMemo(() => calcularTotaisRelatorio(lancamentosFiltrados), [lancamentosFiltrados]);

  if (carregando || !dados) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { profissionais, servicos, regras } = dados;
  const profissionalPorId = new Map(profissionais.map((p) => [p.id, p]));
  const servicoPorId = new Map(servicos.map((s) => [s.id, s]));
  const profissionalSelecionado = profissionais.find((p) => p.id === profissionalSelecionadoId);
  const servicosDoProfissional = profissionalSelecionado
    ? servicos.filter((s) => profissionalSelecionado.servicosIds.includes(s.id))
    : [];

  function salvarRegra(profissionalId: string, servicoId: string, tipo: TipoComissao, valor: number) {
    if (!podeGerenciar) return;
    const profissional = profissionais.find((p) => p.id === profissionalId);
    const servico = servicos.find((s) => s.id === servicoId);
    if (!profissional || !servico) return;
    const validacao = validarRegraComissao({ tipo, valor, profissional, servico });
    if (!validacao.valido) {
      notificar(validacao.erro ?? "Regra de comissão inválida.", "erro");
      return;
    }
    comissaoRegraRepository.salvar({ tenantId, profissionalId, servicoId, tipo, valor });
    notificar("Comissão salva.", "sucesso");
    recarregar();
  }

  function removerRegra(regra: RegraComissao) {
    if (!podeGerenciar) return;
    if (!window.confirm("Remover esta regra de comissão? O profissional passa a ficar sem comissão configurada neste serviço.")) return;
    comissaoRegraRepository.remover(regra.id);
    notificar("Regra removida.", "sucesso");
    recarregar();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-ink">Comissões</h1>
        <p className="text-sm text-ink-soft">Quanto cada atendimento concluído reparte entre profissional e estabelecimento.</p>
      </div>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <h2 className="text-lg font-semibold text-ink">Configuração</h2>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Profissional</label>
            <select
              value={profissionalSelecionadoId}
              onChange={(e) => setProfissionalSelecionadoId(e.target.value)}
              className="w-full max-w-sm rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="">Selecione...</option>
              {profissionais.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>

          {profissionalSelecionado && servicosDoProfissional.length === 0 && (
            <EstadoVazio icone={Percent} titulo="Este profissional não tem serviços vinculados." />
          )}

          {profissionalSelecionado &&
            servicosDoProfissional.map((servico) => {
              const regra = regras.find((r) => r.profissionalId === profissionalSelecionado.id && r.servicoId === servico.id);
              return (
                <LinhaConfiguracaoServico
                  key={servico.id}
                  profissionalId={profissionalSelecionado.id}
                  servico={servico}
                  regra={regra}
                  podeGerenciar={podeGerenciar}
                  onSalvar={salvarRegra}
                  onRemover={removerRegra}
                />
              );
            })}
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <h2 className="text-lg font-semibold text-ink">Relatório</h2>
          <div className="flex flex-wrap gap-2">
            <select
              value={filtroProfissionalId}
              onChange={(e) => setFiltroProfissionalId(e.target.value)}
              className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="todos">Todos os profissionais</option>
              {profissionais.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as StatusLancamentoComissao | "todos")}
              className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="todos">Todos os status</option>
              <option value="confirmado">Confirmado</option>
              <option value="estornado">Estornado</option>
            </select>
            <input
              type="date"
              value={filtroInicio}
              onChange={(e) => setFiltroInicio(e.target.value)}
              className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
            <input
              type="date"
              value={filtroFim}
              onChange={(e) => setFiltroFim(e.target.value)}
              className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>

          {lancamentosFiltrados.length === 0 ? (
            <EstadoVazio icone={Percent} titulo="Nenhum lançamento de comissão neste filtro." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase text-ink-soft">
                    <th className="py-2 pr-3">Data</th>
                    <th className="py-2 pr-3">Profissional</th>
                    <th className="py-2 pr-3">Serviço</th>
                    <th className="py-2 pr-3">Valor do serviço</th>
                    <th className="py-2 pr-3">Comissão</th>
                    <th className="py-2 pr-3">Profissional</th>
                    <th className="py-2 pr-3">Estabelecimento</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lancamentosFiltrados.map((l) => (
                    <tr key={l.id} className="border-b border-border/60">
                      <td className="py-2 pr-3">{formatarData(l.dataAtendimento)}</td>
                      <td className="py-2 pr-3">{profissionalPorId.get(l.profissionalId)?.nome ?? "—"}</td>
                      <td className="py-2 pr-3">{servicoPorId.get(l.servicoId)?.nome ?? "—"}</td>
                      <td className="py-2 pr-3">{formatarMoeda(l.precoAgendamentoCentavos)}</td>
                      <td className="py-2 pr-3">
                        {l.tipoComissao === "percentual" ? `${l.valorRegraAplicada}%` : `${formatarMoeda(l.valorRegraAplicada)} fixo`}
                      </td>
                      <td className="py-2 pr-3">{formatarMoeda(l.valorProfissionalCentavos)}</td>
                      <td className="py-2 pr-3">{formatarMoeda(l.valorEstabelecimentoCentavos)}</td>
                      <td className="py-2 pr-3">
                        <Badge cor={l.status === "confirmado" ? "sucesso" : "neutro"}>
                          {l.status === "confirmado" ? "Confirmado" : "Estornado"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid gap-2 border-t border-border pt-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase text-ink-soft">Total dos serviços</p>
              <p className="font-bold text-ink">{formatarMoeda(totais.totalServicosCentavos)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-ink-soft">Total dos profissionais</p>
              <p className="font-bold text-ink">{formatarMoeda(totais.totalProfissionalCentavos)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-ink-soft">Total do estabelecimento</p>
              <p className="font-bold text-ink">{formatarMoeda(totais.totalEstabelecimentoCentavos)}</p>
            </div>
          </div>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}

function LinhaConfiguracaoServico({
  profissionalId,
  servico,
  regra,
  podeGerenciar,
  onSalvar,
  onRemover,
}: {
  profissionalId: string;
  servico: { id: string; nome: string; precoCentavos?: number };
  regra: RegraComissao | undefined;
  podeGerenciar: boolean;
  onSalvar: (profissionalId: string, servicoId: string, tipo: TipoComissao, valor: number) => void;
  onRemover: (regra: RegraComissao) => void;
}) {
  const [tipo, setTipo] = useState<TipoComissao>(regra?.tipo ?? "percentual");
  const [valorTexto, setValorTexto] = useState(
    regra ? (regra.tipo === "percentual" ? String(regra.valor) : (regra.valor / 100).toFixed(2).replace(".", ",")) : ""
  );

  const precoServico = servico.precoCentavos;
  const valorNumerico =
    tipo === "percentual" ? Number(valorTexto.replace(",", ".")) || 0 : Math.round(parseFloat(valorTexto.replace(",", ".") || "0") * 100);
  const preview =
    precoServico !== undefined ? calcularComissao(precoServico, { tipo, valor: regra ? regra.valor : valorNumerico }) : null;

  return (
    <div className="rounded-[var(--radius-control)] border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{servico.nome}</p>
          <p className="text-sm text-ink-soft">Preço: {precoServico !== undefined ? formatarMoeda(precoServico) : "Sob consulta"}</p>
        </div>
        {!regra && <Badge cor="neutro">Sem comissão configurada</Badge>}
      </div>

      {podeGerenciar && precoServico !== undefined && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Tipo</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoComissao)}
              className="rounded-[var(--radius-control)] border border-border bg-card px-2 py-1.5 text-sm text-ink"
            >
              <option value="percentual">Percentual</option>
              <option value="fixo">Valor fixo</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">{tipo === "percentual" ? "Percentual (%)" : "Valor (R$)"}</label>
            <input
              type="text"
              inputMode="decimal"
              value={valorTexto}
              onChange={(e) => setValorTexto(e.target.value)}
              className="w-28 rounded-[var(--radius-control)] border border-border bg-card px-2 py-1.5 text-sm text-ink"
            />
          </div>
          <Botao tamanho="sm" onClick={() => onSalvar(profissionalId, servico.id, tipo, valorNumerico)}>
            {regra ? "Salvar" : "Configurar"}
          </Botao>
          {regra && (
            <Botao tamanho="sm" variante="secundaria" onClick={() => onRemover(regra)}>
              Remover
            </Botao>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-[var(--radius-control)] bg-paper-muted p-2.5 text-sm sm:w-72">
        <span className="text-ink-soft">Profissional</span>
        <span className="text-right font-semibold text-ink">{preview ? formatarMoeda(preview.valorProfissionalCentavos) : "—"}</span>
        <span className="text-ink-soft">Estabelecimento</span>
        <span className="text-right font-semibold text-ink">{preview ? formatarMoeda(preview.valorEstabelecimentoCentavos) : "—"}</span>
      </div>
    </div>
  );
}
