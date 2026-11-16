"use client";

// Comissões apuradas (dono), por profissional e período. Lê o relatório do
// servidor (GET /tenants/:id/commissions), que só usa o que foi gravado na
// conclusão de cada atendimento. Nada aqui registra pagamento ao
// profissional; as regras ficam em Profissionais → Comissões.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { caminhoComissoes, ehRelatorioDeComissoes } from "@/lib/api/comissoes-api";
import { mesDe, rotuloDoPeriodo, type PeriodoLocal } from "@/lib/conta/inicio";
import { deslocar } from "@/lib/profissionais/calendario";
import { ROTA_INICIO } from "@/lib/conta/rotas";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoDeApuracao, RelatorioComissoes } from "@/components/conta/relatorio-comissoes";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const MENSAGEM_DE_LEITURA = {
  sessao: "Sua sessão precisa ser verificada novamente. Entre de novo.",
  permissao: "Sua conta não pode ver as comissões deste estabelecimento, ou o plano não inclui comissões.",
  ausente: "Estabelecimento não encontrado.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar as comissões.",
} as const;

const CAMPO = "min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm text-ink sm:w-64";

function periodoInicial(): PeriodoLocal | "mes-atual" {
  const busca = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const de = busca.get("de");
  const ate = busca.get("ate");
  if (de && ate && /^\d{4}-\d{2}-\d{2}$/.test(de) && /^\d{4}-\d{2}-\d{2}$/.test(ate) && de <= ate) return { from: de, to: ate };
  return "mes-atual";
}

export default function ComissoesPage() {
  const { estado: sessao } = useRealAuth();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const [escolha, setEscolha] = useState<PeriodoLocal | "mes-atual" | null>(null);
  const [profissional, setProfissional] = useState("");
  useEffect(() => setEscolha(periodoInicial()), []);

  let caminho: string | null = null;
  if (tenantId && escolha) {
    const busca = new URLSearchParams();
    if (escolha !== "mes-atual") {
      busca.set("from", escolha.from);
      busca.set("to", escolha.to);
    }
    if (profissional) busca.set("professionalId", profissional);
    caminho = `${caminhoComissoes(tenantId)}${busca.size ? `?${busca}` : ""}`;
  }
  const { estado, recarregar, anterior } = useLeituraPlataforma(caminho, ehRelatorioDeComissoes);
  const dados = estado.status === "pronto" ? estado.dados : anterior;
  if (sessao.status !== "autenticado" || !tenantId || !escolha) return null;
  const periodo = escolha === "mes-atual" ? (dados?.period ?? null) : escolha;

  return (
    <PaginaConta
      titulo="Comissões"
      descricao="Quanto cada profissional tem de comissão pelos atendimentos concluídos no período."
      voltar={{ href: ROTA_INICIO, rotulo: "Voltar ao Dashboard" }}
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
      {dados?.professionalOptions && (
        <label className="block text-sm font-medium text-ink">
          Profissional
          <select className={`mt-1 block ${CAMPO}`} value={profissional} onChange={(e) => setProfissional(e.target.value)}>
            <option value="">Todos</option>
            {dados.professionalOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.active ? p.name : `${p.name} (inativo)`}
              </option>
            ))}
          </select>
        </label>
      )}

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
      {dados && <RelatorioComissoes relatorio={dados} visaoDoDono />}
    </PaginaConta>
  );
}
