// Conteúdo da página 404 (src/app/not-found.tsx e src/app/[slug]/not-found.tsx).
// Mesmo visual da página de acesso por convite.
import Link from "next/link";
import { SearchX } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { LinkBotao } from "@/components/ui/button";
import { NOME_PRODUTO } from "@/lib/config";

export function ConteudoNaoEncontrada() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <Link href="/" className="block text-center text-xl font-bold text-ink">
          {NOME_PRODUTO}
        </Link>
        <Cartao>
          <CartaoCorpo className="space-y-4">
            <SearchX size={28} aria-hidden="true" className="text-accent" />
            <h1 className="text-xl font-bold text-ink">Página não encontrada</h1>
            <p className="text-sm text-ink-soft">
              O endereço pode estar incompleto ou ter mudado. Se você veio pelo link de agendamento de um
              estabelecimento, confira o link com ele: a página pode ter sido desativada.
            </p>
            <LinkBotao href="/" className="w-full">
              Ir para a página inicial
            </LinkBotao>
            <LinkBotao href="/login" variante="secundaria" className="w-full">
              Entrar na minha conta
            </LinkBotao>
          </CartaoCorpo>
        </Cartao>
      </div>
    </main>
  );
}
