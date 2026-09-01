import Link from "next/link";
import { CalendarCheck, MessageSquareOff, ShieldCheck, Smartphone, Sparkles, TimerOff } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { NOME_PRODUTO, SLOGAN_PRODUTO } from "@/lib/config";

const BENEFICIOS = [
  {
    icone: MessageSquareOff,
    titulo: "Menos mensagens no WhatsApp",
    descricao: "O cliente marca sozinho, sem precisar trocar mensagens para achar um horário livre.",
  },
  {
    icone: TimerOff,
    titulo: "Menos faltas",
    descricao: "Confirmações e lembretes claros reduzem os \"esqueci que tinha marcado\".",
  },
  {
    icone: CalendarCheck,
    titulo: "Menos horários vazios",
    descricao: "Agenda sempre visível para o cliente preencher os horários que sobrariam.",
  },
  {
    icone: Smartphone,
    titulo: "Sem aplicativo",
    descricao: "O cliente agenda direto pelo navegador do celular, sem baixar nada.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="font-bold tracking-tight text-ink">{NOME_PRODUTO}</span>
          <Link href="/login">
            <Botao variante="secundaria" tamanho="sm">
              Entrar na demonstração
            </Botao>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-4 py-14 sm:px-8 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-[color:var(--color-accent-hover)]">
              <Sparkles size={14} /> Protótipo de demonstração
            </span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-5xl">
              {SLOGAN_PRODUTO}
            </h1>
            <p className="mt-4 text-base text-ink-soft sm:text-lg">
              Feito para barbearias pequenas — com espaço para crescer para salões, manicures e outros
              prestadores de serviço.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/dom-navalha">
                <Botao tamanho="lg" className="w-full sm:w-auto">
                  Ver página da barbearia demonstrativa
                </Botao>
              </Link>
              <Link href="/login">
                <Botao tamanho="lg" variante="secundaria" className="w-full sm:w-auto">
                  Explorar todos os painéis
                </Botao>
              </Link>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-paper-muted/60 px-4 py-14 sm:px-8">
          <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFICIOS.map((b) => (
              <Cartao key={b.titulo}>
                <CartaoCorpo>
                  <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-accent-soft text-[color:var(--color-accent-hover)]">
                    <b.icone size={18} />
                  </div>
                  <p className="font-semibold text-ink">{b.titulo}</p>
                  <p className="mt-1 text-sm text-ink-soft">{b.descricao}</p>
                </CartaoCorpo>
              </Cartao>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-14 sm:px-8">
          <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-card p-5 text-sm text-ink-soft">
            <ShieldCheck size={20} className="mt-0.5 shrink-0 text-[color:var(--color-info)]" />
            <p>
              Este é um protótipo com dados simulados e autenticação de demonstração — não há backend,
              banco de dados, pagamentos ou envio real de WhatsApp nesta etapa.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-6 text-center text-xs text-ink-soft sm:px-8">
        {NOME_PRODUTO} — protótipo de demonstração
      </footer>
    </div>
  );
}
