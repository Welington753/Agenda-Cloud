"use client";

import { useState } from "react";
import { ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
import { useClientData } from "@/lib/hooks/use-client-data";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { profissionalRepository, servicoRepository } from "@/lib/repositories";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ModalServico } from "@/components/painel/modal-servico";
import { formatarDuracao, formatarMoeda } from "@/lib/format";
import type { Servico } from "@/lib/types";

export default function PainelServicosPage() {
  return (
    <RequirePermission permissao="servicos.visualizar">
      <ConteudoServicos />
    </RequirePermission>
  );
}

function ConteudoServicos() {
  const { tenantId, terminologia, estabelecimento } = useTenant();
  const { notificar } = useToast();
  const [modalAberto, setModalAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Servico | null>(null);

  const { dados, carregando, recarregar } = useClientData(() => ({
    servicos: servicoRepository.listarPorTenant(tenantId),
    profissionais: profissionalRepository.listarPorTenant(tenantId).filter((p) => p.ativo),
  }), [tenantId]);

  if (carregando || !dados || !estabelecimento) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { servicos, profissionais } = dados;

  function remover(servico: Servico) {
    if (!window.confirm(`Remover "${servico.nome}"? Essa ação não pode ser desfeita.`)) return;
    servicoRepository.remover(servico.id);
    notificar(`${terminologia.servico.singular} removido.`, "sucesso");
    recarregar();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">{terminologia.servico.plural}</h1>
          <p className="text-sm text-ink-soft">Preços, duração e quem realiza cada um.</p>
        </div>
        <Botao
          tamanho="sm"
          onClick={() => {
            setEmEdicao(null);
            setModalAberto(true);
          }}
        >
          <Plus size={16} className="mr-1.5" /> Nov{terminologia.servico.artigo === "a" ? "a" : "o"} {terminologia.servico.singular.toLowerCase()}
        </Botao>
      </div>

      {servicos.length === 0 ? (
        <EstadoVazio
          icone={ClipboardList}
          titulo={`Nenhum${terminologia.servico.artigo === "a" ? "a" : ""} ${terminologia.servico.singular.toLowerCase()} cadastrad${terminologia.servico.artigo === "a" ? "a" : "o"} ainda`}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {servicos.map((servico) => (
            <Cartao key={servico.id}>
              <CartaoCorpo className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{servico.nome}</p>
                    <p className="text-sm text-ink-soft">{servico.descricaoCurta}</p>
                  </div>
                  <Badge cor={servico.ativoNoAgendamentoPublico ? "sucesso" : "neutro"}>
                    {servico.ativoNoAgendamentoPublico ? "Público" : "Oculto"}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-accent">
                    {servico.precoCentavos === undefined ? "Sob consulta" : formatarMoeda(servico.precoCentavos)}
                  </span>
                  {servico.precoCentavos !== undefined && !servico.precoVisivel && (
                    <Badge cor="aviso">Oculto no público</Badge>
                  )}
                  <span className="text-ink-soft">{formatarDuracao(servico.duracaoMinutos)}</span>
                  {servico.exigeConfirmacaoManual && <Badge cor="info">Confirmação manual</Badge>}
                </div>
                <div className="flex gap-2">
                  <Botao
                    tamanho="sm"
                    variante="secundaria"
                    className="flex-1"
                    onClick={() => {
                      setEmEdicao(servico);
                      setModalAberto(true);
                    }}
                  >
                    <Pencil size={14} className="mr-1.5" /> Editar
                  </Botao>
                  <Botao tamanho="sm" variante="secundaria" onClick={() => remover(servico)}>
                    <Trash2 size={14} />
                  </Botao>
                </div>
              </CartaoCorpo>
            </Cartao>
          ))}
        </div>
      )}

      <ModalServico
        aberto={modalAberto}
        aoFechar={() => setModalAberto(false)}
        tenantId={tenantId}
        profissionais={profissionais}
        servicoEmEdicao={emEdicao}
        intervaloPadraoMinutos={estabelecimento.regras.intervaloPadraoMinutos}
        terminologia={terminologia}
        onSalvo={recarregar}
      />
    </div>
  );
}
