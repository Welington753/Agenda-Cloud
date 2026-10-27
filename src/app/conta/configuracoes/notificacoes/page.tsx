"use client";

// Configurações → Notificações (só o dono, que é quem recebe os avisos de
// novas solicitações): notificações neste aparelho e som dos avisos.
//
// Reaproveita os controles que já existiam (Web Push e preferência de som):
// a permissão do navegador só é pedida depois do toque em "Ativar", nunca ao
// abrir a página; inscrições, service worker, VAPID e a orientação para
// instalar no iPhone continuam os mesmos.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { NotificacoesDoDispositivo } from "./notificacoes-do-dispositivo";
import { PreferenciasDeAviso } from "./preferencias-de-aviso";

export default function NotificacoesPage() {
  const { estado } = useRealAuth();
  const router = useRouter();
  const sessao = estado.status === "autenticado" ? estado.sessao : null;
  const tenantId = estado.status === "autenticado" ? estado.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantId;

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  if (!sessao || !tenantId) return null;

  return (
    <PaginaConta
      titulo="Notificações"
      descricao="Avisos de novas solicitações de agendamento neste aparelho."
    >
      <section id="notificacoes" className="space-y-3" aria-label="Notificações">
        <NotificacoesDoDispositivo tenantId={tenantId} />
        <PreferenciasDeAviso />
      </section>
    </PaginaConta>
  );
}
