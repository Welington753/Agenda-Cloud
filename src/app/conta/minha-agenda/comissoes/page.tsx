"use client";

// As PRÓPRIAS comissões do funcionário (GET /tenants/:id/my-agenda/commissions),
// só quando o dono liberou em "Equipe e acessos". O profissional nunca vai na
// URL: o servidor descobre pelo vínculo da sessão. Sem o recebimento do
// cliente e sem os colegas.
import { useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { caminhoProprias, ehRelatorioDeComissoes } from "@/lib/api/comissoes-api";
import { mesDe, rotuloDoPeriodo, type PeriodoLocal } from "@/lib/conta/inicio";
import { deslocar } from "@/lib/profissionais/calendario";
import { ROTA_MINHA_AGENDA } from "@/lib/conta/rotas";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoDeApuracao, RelatorioComissoes } from "@/components/conta/relatorio-comissoes";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const MENSAGEM_DE_LEITURA = {
  sessao: "Sua sessão precisa ser verificada novamente. Entre de novo.",
  permissao: "O estabelecimento não liberou a consulta das suas comissões.",
  ausente: "Estabelecimento não encontrado.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar suas comissões.",
} as const;

export default function MinhasComissoesPage() {
  const { estado: sessao } = useRealAuth();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const [escolha, setEscolha] = useState<PeriodoLocal | "mes-atual">("mes-atual");

  const base = tenantId ? caminhoProprias(tenantId) : null;
  const { estado, recarregar, anterior } = useLeituraPlataforma(
    base && escolha !== "mes-atual" ? `${base}?from=${escolha.from}&to=${escolha.to}` : base,
    ehRelatorioDeComissoes,
  );
  const dados = estado.status === "pronto" ? estado.dados : anterior;
  if (sessao.status !== "autenticado" || !tenantId) return null;
  const periodo = escolha === "mes-atual" ? (dados?.period ?? null) : escolha;

  return (
    <PaginaConta
      titulo="Minhas comissões"
      descricao={dados?.professional ? `Comissões de ${dados.professional.name}` : "Suas comissões neste estabelecimento."}
      voltar={{ href: ROTA_MINHA_AGENDA, rotulo: "Voltar à minha agenda" }}
      acoes={
        <Botao type="button" variante="secundaria" className="min-h-11" onClick={recarregar}>
          <RefreshCw size={16} aria-hidden="true" />
          Atualizar
        </Botao>
      }
    >
      <AvisoDeApuracao />
      <div className="flex flex-wrap items-center gap-2">
        <Botao
          type="button"
          variante="secundaria"
          aria-label="Mês anterior"
          disabled={!periodo}
          onClick={() => periodo && setEscolha(mesDe(deslocar("mes", periodo.from, -1)))}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </Botao>
        <p className="min-w-0 text-sm font-semibold text-ink" data-testid="periodo-comissoes">
          {periodo ? rotuloDoPeriodo(periodo) : "Mês atual"}
        </p>
        <Botao
          type="button"
          variante="secundaria"
          aria-label="Próximo mês"
          disabled={!periodo}
          onClick={() => periodo && setEscolha(mesDe(deslocar("mes", periodo.from, 1)))}
        >
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
      {dados && <RelatorioComissoes relatorio={dados} visaoDoDono={false} />}
    </PaginaConta>
  );
}
