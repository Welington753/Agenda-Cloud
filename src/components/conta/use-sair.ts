"use client";

// "Sair" da área real, o mesmo no menu da conta e em Perfil e segurança: as
// notificações deste aparelho param junto com a sessão (no máximo 1,5 s de
// espera; o servidor já não envia para sessão encerrada), a sessão é
// encerrada no servidor e a pessoa vai para o login. Barreira contra clique
// duplo enquanto o logout está em voo.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encerrarNoDispositivo } from "@/lib/push/dispositivo";
import { useToast } from "@/components/ui/toast";

export function useSair(): { saindo: boolean; sair: () => Promise<void> } {
  const { estado, logout } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);
  const tenantIdAtivo = estado.status === "autenticado" ? estado.tenantIdAtivo : null;

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    await encerrarNoDispositivo(tenantIdAtivo);
    const resultado = await logout();
    notificar(
      resultado.confirmadoPeloServidor
        ? "Sessão encerrada."
        : "Não foi possível confirmar o encerramento com o servidor. Você saiu apenas neste dispositivo.",
      resultado.confirmadoPeloServidor ? "sucesso" : "info",
    );
    router.push("/login");
  }

  return { saindo, sair };
}
