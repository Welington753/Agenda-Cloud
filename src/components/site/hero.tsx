import { CalendarCheck, MessageSquareOff, Smartphone, TimerOff } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { LinkBotao } from "@/components/ui/button";
import { SLOGAN_PRODUTO } from "@/lib/config";
import { HREF_ENTRAR, HREF_TESTAR_GRATIS } from "@/lib/site/conteudo-comercial";

const BENEFICIOS = [
  { icone: MessageSquareOff, titulo: "Menos mensagens", descricao: "O cliente marca sozinho, sem trocar mensagens para achar um horário livre." },
  { icone: TimerOff, titulo: "Menos faltas", descricao: "Lembretes e confirmações claras reduzem os esquecimentos." },
  { icone: CalendarCheck, titulo: "Agenda sempre visível", descricao: "Todos os horários do dia num só lugar, para você e para o cliente." },
  { icone: Smartphone, titulo: "Sem aplicativo", descricao: "Funciona direto pelo navegador, no celular ou no computador." },
];

export function Hero() {
  return (
    <section id="produto" className="mx-auto max-w-5xl px-4 py-14 sm:px-8 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-5xl">{SLOGAN_PRODUTO}</h1>
        <p className="mt-4 text-base text-ink-soft sm:text-lg">
          Para salões, clínicas, estúdios, terapeutas, pet shops e qualquer negócio que atenda com hora marcada.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <LinkBotao href={HREF_TESTAR_GRATIS} tamanho="lg" className="w-full sm:w-auto">
            Testar grátis
          </LinkBotao>
          <LinkBotao href={HREF_ENTRAR} tamanho="lg" variante="secundaria" className="w-full sm:w-auto">
            Entrar
          </LinkBotao>
        </div>
      </div>

      <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
  );
}
