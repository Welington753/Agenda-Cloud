"use client";

// "Notificações neste dispositivo" (Web Push): aviso de solicitação nova
// mesmo com o aplicativo em segundo plano ou a tela bloqueada, quando o
// aparelho e o navegador permitem.
//
// - A permissão do navegador só é pedida no CLIQUE de "Ativar notificações
//   neste dispositivo", nunca ao abrir a tela.
// - Estados mostrados: ativado, desativado, bloqueado (permissão negada nas
//   configurações), não suportado, instalar no iPhone, servidor sem push.
// - "Ativado" vale para ESTE aparelho, ESTE estabelecimento e ESTA sessão:
//   sair da conta desliga (ver encerrarNoDispositivo e a migration WebPush).
import { BellOff, BellRing, Smartphone } from "lucide-react";
import { useNotificacoesDoDispositivo } from "@/lib/push/use-notificacoes-do-dispositivo";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function NotificacoesDoDispositivo({ tenantId }: { tenantId: string }) {
  // Verificação, ativar e desativar: lib/push/use-notificacoes-do-dispositivo.ts
  // (o mesmo estado que o menu da conta resume).
  const { estado, ocupado, aviso, verificar, ativar, desativar } = useNotificacoesDoDispositivo(tenantId);

  return (
    <Cartao data-testid="notificacoes-dispositivo" data-estado={estado.tipo}>
      <CartaoCorpo className="space-y-3">
        <div className="flex items-start gap-3">
          <Smartphone size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h3 className="text-base font-semibold text-ink">Notificações neste dispositivo</h3>
            <p className="text-sm text-ink-soft">
              Receba um aviso de solicitação nova mesmo com o aplicativo em segundo plano ou a tela
              bloqueada, quando o aparelho permitir. O aviso é discreto: não mostra o nome do cliente.
            </p>
          </div>
        </div>

        {estado.tipo === "verificando" && <Skeleton className="h-10 w-full" />}

        {estado.tipo === "ativado" && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-ink" data-testid="push-estado">
              <BellRing size={16} aria-hidden="true" /> Ativado neste dispositivo
            </p>
            <Botao variante="secundaria" onClick={() => void desativar(estado.publicKey)} disabled={ocupado} data-testid="desativar-push">
              {ocupado ? "Desativando..." : "Desativar neste dispositivo"}
            </Botao>
          </div>
        )}

        {estado.tipo === "desativado" && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-ink" data-testid="push-estado">
              <BellOff size={16} aria-hidden="true" /> Desativado neste dispositivo
            </p>
            <Botao onClick={() => void ativar(estado.publicKey)} disabled={ocupado} data-testid="ativar-push">
              {ocupado ? "Ativando..." : "Ativar notificações neste dispositivo"}
            </Botao>
          </div>
        )}

        {estado.tipo === "bloqueado" && (
          <p className="text-sm text-ink" data-testid="push-estado">
            <strong>Bloqueado.</strong> As notificações deste site estão bloqueadas nas configurações do
            navegador ou do aparelho. Para receber, libere as notificações do Agenda Cloud por lá e volte a
            esta tela.
          </p>
        )}

        {estado.tipo === "nao_suportado" && (
          <p className="text-sm text-ink" data-testid="push-estado">
            <strong>Não suportado.</strong> Este navegador não oferece notificações push. Os avisos continuam
            aparecendo enquanto o sistema estiver aberto.
          </p>
        )}

        {estado.tipo === "instalar_no_iphone" && (
          <div className="space-y-2 text-sm text-ink" data-testid="push-estado">
            <p>
              <strong>No iPhone ou iPad</strong>, as notificações só funcionam com o Agenda Cloud adicionado à
              Tela de Início, no iOS 16.4 ou mais recente:
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Abra este endereço no Safari.</li>
              <li>Toque em Compartilhar e escolha “Adicionar à Tela de Início”.</li>
              <li>Abra o Agenda Cloud pelo ícone novo, entre na conta e volte a esta tela.</li>
            </ol>
            <p className="text-ink-soft">Se o botão de ativar não aparecer depois disso, o aparelho não oferece este recurso.</p>
          </div>
        )}

        {estado.tipo === "servidor_sem_push" && (
          <p className="text-sm text-ink" data-testid="push-estado">
            O servidor ainda não está configurado para enviar notificações. Os avisos com o sistema aberto
            continuam funcionando.
          </p>
        )}

        {estado.tipo === "falha" && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-ink" data-testid="push-estado">
              {estado.mensagem}
            </p>
            <Botao variante="secundaria" onClick={() => void verificar()}>
              Tentar de novo
            </Botao>
          </div>
        )}

        {aviso && (
          <p role="alert" className="text-sm text-ink" data-testid="push-aviso">
            {aviso}
          </p>
        )}

        <p className="text-xs text-ink-soft">
          A entrega depende do aparelho: economia de bateria, modo foco ou falta de conexão podem atrasar ou
          esconder o aviso. Os pedidos ficam sempre guardados nesta lista.
        </p>
      </CartaoCorpo>
    </Cartao>
  );
}
