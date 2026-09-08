import { NOME_PRODUTO } from "@/lib/config";

export function SiteFooter() {
  return (
    <footer className="border-t border-border px-4 py-6 text-center text-xs text-ink-soft sm:px-8">
      {NOME_PRODUTO} — protótipo de demonstração. Sem dados reais, cobrança ou envio de mensagens nesta etapa.
    </footer>
  );
}
