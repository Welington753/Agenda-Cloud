"use client";

// O link público de agendamento do estabelecimento, para a equipe copiar ou
// abrir e mandar a um cliente. É o mesmo link de sempre (`/agendar/[slug]`):
// a página pública ainda não aceita um profissional pré-escolhido, então
// nenhum parâmetro é inventado. Compartilhar o link não dá a ninguém
// permissão de criar ou alterar reservas pelo painel; quem decide se o
// agendamento online está ligado é o responsável.
import { useEffect, useState } from "react";
import { Copy, ExternalLink, Link2 } from "lucide-react";
import { linkPublico } from "@/lib/agendamento-publico/agendamento-publico";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

export function LinkDeAgendamento({ slug }: { slug: string }) {
  // A origem só existe no navegador; até lá, o link não é montado.
  const [origem, setOrigem] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<"sim" | "falhou" | null>(null);
  useEffect(() => setOrigem(window.location.origin), []);
  const link = origem ? linkPublico(origem, slug) : null;

  async function copiar() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado("sim");
    } catch {
      setCopiado("falhou");
    }
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-2 text-sm" data-testid="link-agendamento">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <Link2 size={16} aria-hidden="true" />
          Link de agendamento do estabelecimento
        </p>
        {link && (
          <p className="break-all text-ink-soft" data-testid="link-agendamento-endereco">
            {link}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Botao type="button" variante="secundaria" className="min-h-11" disabled={!link} onClick={() => void copiar()}>
            <Copy size={16} aria-hidden="true" />
            Copiar link
          </Botao>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium text-ink hover:bg-paper-muted"
            >
              <ExternalLink size={16} aria-hidden="true" />
              Abrir link
            </a>
          )}
        </div>
        <p className="text-xs text-ink-soft" role="status">
          {copiado === "sim"
            ? "Link copiado."
            : copiado === "falhou"
              ? "Não foi possível copiar. Selecione o endereço acima e copie."
              : "O cliente escolhe serviço, profissional e horário. Funciona enquanto o agendamento online estiver ligado pelo responsável."}
        </p>
      </CartaoCorpo>
    </Cartao>
  );
}
