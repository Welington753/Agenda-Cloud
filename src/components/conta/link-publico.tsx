"use client";

// Link público do agendamento online: "Copiar link" e "Abrir página". Usado
// no cartão "Agendamento online" (Solicitações) e no atalho da Visão geral.
// Só mostra e copia o link; ligar ou desligar a página continua sendo o
// botão explícito do dono em Solicitações.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, Globe } from "lucide-react";
import {
  obterConfiguracaoOnline,
  type ConfiguracaoAgendamentoOnline,
} from "@/lib/api/booking-requests-api";
import { linkPublico } from "@/lib/agendamento-publico/agendamento-publico";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

const CLASSE_ABRIR =
  "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-card px-3 text-sm font-medium text-ink hover:bg-paper-muted";

export function BotoesDoLinkPublico({
  link,
  aoFalharCopia,
}: {
  link: string;
  /** Sem permissão de área de transferência (ou fora de HTTPS). */
  aoFalharCopia: (mensagem: string) => void;
}) {
  const { notificar } = useToast();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      notificar("Link copiado.", "sucesso");
    } catch {
      aoFalharCopia("Não foi possível copiar automaticamente. Selecione o link e copie.");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Botao variante="secundaria" onClick={() => void copiar()} data-testid="copiar-link">
        <Copy size={16} aria-hidden="true" /> Copiar link
      </Botao>
      <a href={link} target="_blank" rel="noopener noreferrer" className={CLASSE_ABRIR} data-testid="abrir-pagina-publica">
        <ExternalLink size={16} aria-hidden="true" /> Abrir página
        <span className="sr-only"> (abre em outra aba)</span>
      </a>
    </div>
  );
}

/**
 * Atalho da Visão geral. Lê a configuração gravada (GET de
 * /tenants/:id/public-booking, só DONO): com a página ativa mostra o link;
 * desativada, aponta para Solicitações, onde o dono decide. Sem permissão
 * ou com falha, não mostra nada — a Visão geral segue sem o atalho.
 */
export function AtalhoLinkPublico({ tenantId }: { tenantId: string }) {
  const [config, setConfig] = useState<ConfiguracaoAgendamentoOnline | null>(null);
  const [origem, setOrigem] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(
    async (signal: AbortSignal) => {
      const r = await obterConfiguracaoOnline(tenantId, signal);
      if (!signal.aborted) setConfig(r.ok ? r.dados : null);
    },
    [tenantId],
  );

  useEffect(() => {
    setOrigem(window.location.origin);
    const controle = new AbortController();
    void carregar(controle.signal);
    return () => controle.abort();
  }, [carregar]);

  if (!config || !origem) return null;
  const link = linkPublico(origem, config.slug);

  return (
    <Cartao data-testid="atalho-link-publico">
      <CartaoCorpo className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Globe size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">
              {config.enabled ? "Seu link de agendamento online" : "Agendamento online desativado"}
            </p>
            {config.enabled ? (
              <p className="truncate text-sm text-ink-soft" data-testid="atalho-link-publico-url">
                {link}
              </p>
            ) : (
              <Link
                href="/conta/configuracoes/estabelecimento"
                className="text-sm font-medium text-[color:var(--color-accent-hover)] hover:underline"
              >
                Ativar em Configurações
              </Link>
            )}
            {erro && (
              <p role="alert" className="text-sm text-ink">
                {erro}
              </p>
            )}
          </div>
        </div>
        {config.enabled && <BotoesDoLinkPublico link={link} aoFalharCopia={setErro} />}
      </CartaoCorpo>
    </Cartao>
  );
}
