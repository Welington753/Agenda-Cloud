"use client";

// Cartão "Agendamento online" da tela de Solicitações: ligar/desligar a
// página pública (só DONO, conferido no servidor) e copiar o link. Ninguém
// fica exposto sem este clique: sem a configuração gravada, a página não
// existe para o público.
import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Globe } from "lucide-react";
import {
  obterConfiguracaoOnline,
  salvarConfiguracaoOnline,
  type ConfiguracaoAgendamentoOnline,
  type FalhaPrivada,
} from "@/lib/api/booking-requests-api";
import { linkPublico } from "@/lib/agendamento-publico/agendamento-publico";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

export function mensagemFalhaPrivada(falha: FalhaPrivada): string {
  switch (falha.tipo) {
    case "sem_permissao":
      return falha.mensagem ?? "Você não tem permissão para esta área.";
    case "falha_comunicacao":
      return "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.";
    case "sem_acesso":
      return "Estabelecimento não encontrado.";
    case "nao_autenticado":
      return "Sua sessão terminou. Entre de novo.";
    default:
      return "O servidor não respondeu como esperado. Tente de novo em instantes.";
  }
}

export function AgendamentoOnline({ tenantId }: { tenantId: string }) {
  const { notificar } = useToast();
  const [estado, setEstado] = useState<
    | { status: "carregando" }
    | { status: "falha"; falha: FalhaPrivada }
    | { status: "pronto"; config: ConfiguracaoAgendamentoOnline }
  >({ status: "carregando" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [origem, setOrigem] = useState("");

  const carregar = useCallback(async () => {
    const r = await obterConfiguracaoOnline(tenantId);
    setEstado(r.ok ? { status: "pronto", config: r.dados } : { status: "falha", falha: r.falha });
  }, [tenantId]);

  useEffect(() => {
    setOrigem(window.location.origin);
    void carregar();
  }, [carregar]);

  async function alternar(enabled: boolean) {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    const r = await salvarConfiguracaoOnline(tenantId, enabled);
    setSalvando(false);
    if (r.ok) {
      setEstado({ status: "pronto", config: r.dados });
      notificar(enabled ? "Agendamento online ativado." : "Agendamento online desativado.", "sucesso");
      return;
    }
    setErro(
      r.falha.tipo === "falha_comunicacao"
        ? "A conexão falhou antes de o servidor confirmar. A alteração pode ter sido gravada: atualize a página para conferir."
        : mensagemFalhaPrivada(r.falha),
    );
  }

  async function copiar(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      notificar("Link copiado.", "sucesso");
    } catch {
      setErro("Não foi possível copiar automaticamente. Selecione o link e copie.");
    }
  }

  return (
    <Cartao data-testid="agendamento-online">
      <CartaoCorpo className="space-y-3">
        <div className="flex items-start gap-3">
          <Globe size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-ink">Agendamento online</h2>
            <p className="text-sm text-ink-soft">
              Com a página ativa, clientes escolhem serviço, profissional e horário e enviam um pedido.
              Todo pedido chega aqui aguardando a sua confirmação.
            </p>
          </div>
        </div>

        {estado.status === "carregando" && <Skeleton className="h-10 w-full" />}
        {estado.status === "falha" && (
          <p role="alert" className="text-sm text-ink" data-testid="agendamento-online-falha">
            {mensagemFalhaPrivada(estado.falha)}
          </p>
        )}
        {estado.status === "pronto" && (
          <>
            <p className="text-sm font-medium text-ink" data-testid="agendamento-online-estado">
              {estado.config.enabled ? "Página ativa" : "Página desativada — ninguém consegue acessá-la"}
            </p>
            {estado.config.enabled && origem && (
              <div className="space-y-2">
                <input
                  readOnly
                  aria-label="Link da página de agendamento"
                  value={linkPublico(origem, estado.config.slug)}
                  data-testid="link-publico"
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-paper-muted px-3 text-sm text-ink"
                />
                <div className="flex flex-wrap gap-2">
                  <Botao variante="secundaria" onClick={() => void copiar(linkPublico(origem, estado.config.slug))} data-testid="copiar-link">
                    <Copy size={16} aria-hidden="true" /> Copiar link
                  </Botao>
                  <a
                    href={linkPublico(origem, estado.config.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-card px-3 text-sm font-medium text-ink hover:bg-paper-muted"
                  >
                    <ExternalLink size={16} aria-hidden="true" /> Abrir página
                  </a>
                </div>
              </div>
            )}
            <Botao
              variante={estado.config.enabled ? "secundaria" : "primaria"}
              onClick={() => void alternar(!estado.config.enabled)}
              disabled={salvando}
              data-testid="alternar-agendamento-online"
            >
              {salvando ? "Salvando..." : estado.config.enabled ? "Desativar página" : "Ativar agendamento online"}
            </Botao>
          </>
        )}
        {erro && (
          <p role="alert" className="text-sm text-ink" data-testid="agendamento-online-erro">
            {erro}
          </p>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
