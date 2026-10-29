"use client";

// Estabelecimento com o acesso vencido (fim do teste, do período pago ou da
// cortesia). Aparece no lugar das páginas do estabelecimento; a
// administração da plataforma, a escolha de estabelecimento e as
// configurações pessoais continuam abertas. Nada foi apagado: o servidor só
// recusa as rotas do estabelecimento (ACESSO_VENCIDO) até a administração
// registrar o pagamento.
import { CircleAlert } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import type { TenantContextReal } from "@/lib/api/auth-api";

const O_QUE_VENCEU = { TRIAL: "O teste gratuito", PAID: "O período pago", COURTESY: "A cortesia" } as const;

const data = (instante: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(instante));

export function AcessoVencido({ contexto }: { contexto: TenantContextReal }) {
  const acesso = contexto.access;
  const oQue = acesso?.expiredKind ? O_QUE_VENCEU[acesso.expiredKind] : "O período de acesso";
  const quando = acesso?.expiredAt ? ` terminou em ${data(acesso.expiredAt)}` : " terminou";
  const responsavel = contexto.role === "DONO";
  return (
    <Cartao>
      <CartaoCorpo className="max-w-2xl space-y-4" data-testid="acesso-vencido">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <CircleAlert aria-hidden className="size-6 shrink-0 text-[color:var(--color-warning)]" />
          Acesso de {contexto.tenantName} pausado
        </h1>
        <p>
          {oQue} de {contexto.tenantName}
          {quando}.
        </p>
        <p className="text-sm text-ink-soft">
          Nada foi apagado: agenda, clientes, reservas, recebimentos, equipe e histórico estão guardados. As reservas já
          feitas continuam valendo, mas o agendamento online não recebe pedidos novos enquanto o acesso estiver pausado.
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
      </CartaoCorpo>
    </Cartao>
  );
}
