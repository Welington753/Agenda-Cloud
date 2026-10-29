"use client";

// Estabelecimento com o acesso pausado (fim do teste, do período pago ou da
// cortesia, ou nenhum período registrado). Aparece no lugar das páginas do
// estabelecimento; a administração da plataforma, a escolha de
// estabelecimento, Perfil e segurança e a saída continuam abertas. Nada foi
// apagado nem cancelado: o servidor só recusa as rotas do estabelecimento
// (ACESSO_VENCIDO) até a administração registrar a validade.
//
// Só o DONO recebe o motivo (o que venceu e quando); os outros papéis
// recebem apenas que o acesso está pausado.
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import type { TenantContextReal } from "@/lib/api/auth-api";
import { ROTA_PERFIL } from "@/lib/conta/rotas";

const O_QUE_VENCEU = { TRIAL: "O teste gratuito", PAID: "O período pago", COURTESY: "A cortesia" } as const;

const data = (instante: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(instante));

function motivo(contexto: TenantContextReal): string {
  const acesso = contexto.access;
  if (acesso?.state === "MISSING") return `Não há período de acesso registrado para ${contexto.tenantName}.`;
  const oQue = acesso?.expiredKind ? O_QUE_VENCEU[acesso.expiredKind] : "O período de acesso";
  const quando = acesso?.expiredAt ? ` terminou em ${data(acesso.expiredAt)}` : " terminou";
  return `${oQue} de ${contexto.tenantName}${quando}.`;
}

export function AcessoVencido({ contexto }: { contexto: TenantContextReal }) {
  const responsavel = contexto.role === "DONO";
  return (
    <Cartao>
      <CartaoCorpo className="max-w-2xl space-y-4" data-testid="acesso-vencido">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <CircleAlert aria-hidden className="size-6 shrink-0 text-[color:var(--color-warning)]" />
          Acesso de {contexto.tenantName} pausado
        </h1>
        {responsavel && <p>{motivo(contexto)}</p>}
        <p className="text-sm text-ink-soft">
          Nada foi apagado nem cancelado: agenda, clientes, reservas, recebimentos, equipe e histórico estão guardados.
          As reservas já feitas continuam valendo, mas o agendamento online não recebe pedidos novos enquanto o acesso
          estiver pausado.
        </p>
        {responsavel ? (
          <div className="space-y-1">
            <h2 className="font-semibold">Como regularizar</h2>
            <p className="text-sm">
              Fale com a administração do Agenda Cloud pelo mesmo canal do seu cadastro para combinar o pagamento. Assim
              que ele for registrado, o acesso volta na hora, com tudo como estava.
            </p>
          </div>
        ) : (
          <p className="text-sm">
            A pessoa responsável pelo estabelecimento vê este aviso e o caminho de regularização. Quando o acesso voltar,
            tudo continua como estava.
          </p>
        )}
        <p className="text-sm">
          Sua conta continua com você: em{" "}
          <Link href={ROTA_PERFIL} className="inline-flex min-h-11 items-center font-medium underline">
            Perfil e segurança
          </Link>{" "}
          você troca a senha e confere seus dados, e pode sair pelo menu da conta.
        </p>
      </CartaoCorpo>
    </Cartao>
  );
}
