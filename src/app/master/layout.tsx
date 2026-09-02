"use client";

import type { ReactNode } from "react";
import { Building2, LayoutDashboard, ShieldCheck } from "lucide-react";
import { RequireRole } from "@/components/layout/require-role";
import { AdminShell, type ItemNavegacao } from "@/components/layout/admin-shell";
import { useAuth } from "@/lib/auth/auth-context";
import { useClientData } from "@/lib/hooks/use-client-data";
import { podeAdministrarPlataforma } from "@/lib/access/access-control";
import { usuarioPlataformaRepository } from "@/lib/repositories";
import type { PapelPlataforma, PermissaoPlataforma } from "@/lib/types";

export default function MasterLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole papeisPermitidos={["MASTER_OWNER", "MASTER_ADMIN", "MASTER_SUPPORT"]}>
      <MasterShell>{children}</MasterShell>
    </RequireRole>
  );
}

function MasterShell({ children }: { children: ReactNode }) {
  const { usuario, carregando: carregandoAuth } = useAuth();
  const { dados, carregando: carregandoConta } = useClientData(
    () => (usuario ? usuarioPlataformaRepository.obterPorId(usuario.id) ?? null : null),
    [usuario?.id]
  );
  const carregando = carregandoAuth || carregandoConta;

  const itensCandidatos: (ItemNavegacao & { permissao?: PermissaoPlataforma })[] = [
    { href: "/master", rotulo: "Dashboard", icone: LayoutDashboard },
    { href: "/master/estabelecimentos", rotulo: "Estabelecimentos", icone: Building2, permissao: "estabelecimentos.gerenciar" },
    { href: "/master/administradores", rotulo: "Administradores", icone: ShieldCheck, permissao: "administradores.gerenciar" },
  ];

  // Igual ao menu do /painel: só esconde o que o usuário não pode ver — o acesso
  // direto pela URL continua bloqueado por RequirePlatformPermission dentro de
  // cada página, então esconder aqui é conveniência de navegação, nunca a única
  // barreira.
  const itens: ItemNavegacao[] =
    carregando || !usuario
      ? []
      : itensCandidatos
          .filter((item) => {
            if (!item.permissao) return true;
            return podeAdministrarPlataforma(
              usuario.papel as PapelPlataforma,
              dados?.permissoesExtras ?? [],
              dados?.status ?? "suspenso",
              item.permissao
            ).permitido;
          })
          .map((item) => ({ href: item.href, rotulo: item.rotulo, icone: item.icone }));

  return (
    <AdminShell itens={itens} subtitulo="Administração master">
      {children}
    </AdminShell>
  );
}
