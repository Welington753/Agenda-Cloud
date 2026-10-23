// O cadastro livre foi fechado: contas novas só nascem por convite da
// administração da plataforma, e o servidor recusa o antigo POST
// /auth/register. Esta página só explica como obter acesso; não há
// formulário nem chamada à API. Quem já tem conta continua entrando pelo
// login.
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { LinkBotao } from "@/components/ui/button";
import { NOME_PRODUTO } from "@/lib/config";

export const metadata = { title: `Acesso por convite · ${NOME_PRODUTO}` };

export default function CadastroPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <Link href="/" className="block text-center text-xl font-bold text-ink">
          {NOME_PRODUTO}
        </Link>
        <Cartao>
          <CartaoCorpo className="space-y-4">
            <MailCheck size={28} aria-hidden="true" className="text-accent" />
            <h1 className="text-xl font-bold text-ink">O acesso é liberado pela administração</h1>
            <p className="text-sm text-ink-soft">
              Não há cadastro aberto. A administração do {NOME_PRODUTO} cria o estabelecimento e envia um convite para o
              e-mail do responsável. Pelo link do convite você confere seus dados e cria a sua senha.
            </p>
            <p className="text-sm text-ink-soft">
              Recebeu um convite? Abra o link do e-mail (ele vale por 24 horas). Se ele expirou, peça um novo à
              administração.
            </p>
            <LinkBotao href="/login" className="w-full">
              Já tenho conta: entrar
            </LinkBotao>
          </CartaoCorpo>
        </Cartao>
        <p className="text-center text-xs text-ink-soft">
          Quer marcar um horário? Use o link de agendamento do estabelecimento; não é preciso conta.
        </p>
      </div>
    </main>
  );
}
