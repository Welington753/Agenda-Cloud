"use client";

import { useState } from "react";
import { Pencil, Plus, PowerOff, UserRoundPlus } from "lucide-react";
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
import { ModalProfissional } from "@/components/painel/modal-profissional";
import type { Profissional } from "@/lib/types";

export default function PainelProfissionaisPage() {
  return (
    <RequirePermission permissao="profissionais.visualizar">
      <ConteudoProfissionais />
    </RequirePermission>
  );
}

function ConteudoProfissionais() {
  const { tenantId, terminologia } = useTenant();
  const { notificar } = useToast();
  const [modalAberto, setModalAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Profissional | null>(null);

  const { dados, carregando, recarregar } = useClientData(() => ({
    profissionais: profissionalRepository.listarPorTenant(tenantId),
    servicos: servicoRepository.listarPorTenant(tenantId),
  }), [tenantId]);

  if (carregando || !dados) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { profissionais, servicos } = dados;
  const nomeServico = new Map(servicos.map((s) => [s.id, s.nome]));

  function alternarAtivo(prof: Profissional) {
    profissionalRepository.atualizar(prof.id, { ativo: !prof.ativo });
    notificar(
      prof.ativo ? `${terminologia.profissional.singular} desativado(a).` : `${terminologia.profissional.singular} reativado(a).`,
      "sucesso"
    );
    recarregar();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">{terminologia.equipe}</h1>
          <p className="text-sm text-ink-soft">Gerencie sua equipe e os horários de cada um.</p>
        </div>
        <Botao
          tamanho="sm"
          onClick={() => {
            setEmEdicao(null);
            setModalAberto(true);
          }}
        >
          <Plus size={16} className="mr-1.5" /> Nov{terminologia.profissional.artigo === "a" ? "a" : "o"} {terminologia.profissional.singular.toLowerCase()}
        </Botao>
      </div>

      {profissionais.length === 0 ? (
        <EstadoVazio
          icone={UserRoundPlus}
          titulo={`Nenhum${terminologia.profissional.artigo === "a" ? "a" : ""} ${terminologia.profissional.singular.toLowerCase()} cadastrad${terminologia.profissional.artigo === "a" ? "a" : "o"} ainda`}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profissionais.map((prof) => (
            <Cartao key={prof.id}>
              <CartaoCorpo className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{ backgroundColor: prof.corAvatar }}
                    >
                      {prof.avatarIniciais}
                    </div>
                    <div>
                      <p className="font-semibold text-ink">{prof.nome}</p>
                      <Badge cor={prof.ativo ? "sucesso" : "neutro"}>{prof.ativo ? "Ativo" : "Inativo"}</Badge>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {prof.servicosIds.map((id) => (
                    <Badge key={id} cor="destaque">
                      {nomeServico.get(id) ?? terminologia.servico.singular}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-ink-soft">
                  {prof.agendamentoOnlineAtivo ? "Aceita agendamento online" : "Agendamento online desativado"}
                </p>
                <div className="flex gap-2">
                  <Botao
                    tamanho="sm"
                    variante="secundaria"
                    className="flex-1"
                    onClick={() => {
                      setEmEdicao(prof);
                      setModalAberto(true);
                    }}
                  >
                    <Pencil size={14} className="mr-1.5" /> Editar
                  </Botao>
                  <Botao tamanho="sm" variante="secundaria" className="flex-1" onClick={() => alternarAtivo(prof)}>
                    <PowerOff size={14} className="mr-1.5" /> {prof.ativo ? "Desativar" : "Reativar"}
                  </Botao>
                </div>
              </CartaoCorpo>
            </Cartao>
          ))}
        </div>
      )}

      <ModalProfissional
        aberto={modalAberto}
        aoFechar={() => setModalAberto(false)}
        tenantId={tenantId}
        servicos={servicos}
        profissionalEmEdicao={emEdicao}
        terminologia={terminologia}
        onSalvo={recarregar}
      />
    </div>
  );
}
