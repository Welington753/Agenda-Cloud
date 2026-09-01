"use client";

import type { ReactNode } from "react";
import { CalendarDays, ClipboardList, LayoutDashboard, Paintbrush, Percent, ShieldAlert, Settings, UserCircle, Users } from "lucide-react";
import { RequireRole } from "@/components/layout/require-role";
import { AdminShell, type ItemNavegacao } from "@/components/layout/admin-shell";
import { TenantProvider, useTenant } from "@/lib/tenant/tenant-context";

export default function PainelLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole papeisPermitidos={["dono", "gerente", "recepcionista"]}>
      <TenantProvider>
        <PainelShell>{children}</PainelShell>
      </TenantProvider>
    </RequireRole>
  );
}

function PainelShell({ children }: { children: ReactNode }) {
  const { terminologia, estabelecimento, carregando, podeAcessar } = useTenant();

  const itensCandidatos: (ItemNavegacao & { permissao: Parameters<typeof podeAcessar>[0] })[] = [
    { href: "/painel", rotulo: "Dashboard", icone: LayoutDashboard, permissao: "dashboard.visualizar" },
    { href: "/painel/agenda", rotulo: "Agenda", icone: CalendarDays, permissao: "agenda.visualizar" },
    { href: "/painel/profissionais", rotulo: terminologia.equipe, icone: UserCircle, permissao: "profissionais.visualizar" },
    { href: "/painel/servicos", rotulo: terminologia.servico.plural, icone: ClipboardList, permissao: "servicos.visualizar" },
    { href: "/painel/consumidores", rotulo: terminologia.consumidor.plural, icone: Users, permissao: "consumidores.visualizar" },
    { href: "/painel/equipe", rotulo: "Equipe e acessos", icone: Users, permissao: "equipe.visualizar" },
    { href: "/painel/comissoes", rotulo: "Comissões", icone: Percent, permissao: "comissoes.visualizar" },
    { href: "/painel/personalizacao", rotulo: "Personalização", icone: Paintbrush, permissao: "personalizacao.gerenciar" },
    { href: "/painel/configuracoes", rotulo: "Configurações", icone: Settings, permissao: "configuracoes.gerenciar" },
  ];

  // O menu só esconde o que o usuário não pode ver — o acesso direto pela URL
  // continua bloqueado por `RequirePermission` dentro de cada página, então
  // esconder aqui é conveniência de navegação, nunca a única barreira.
  const itens: ItemNavegacao[] = carregando
    ? []
    : itensCandidatos
        .filter((item) => podeAcessar(item.permissao).permitido)
        .map((item) => ({ href: item.href, rotulo: item.rotulo, icone: item.icone }));

  const subtitulo = estabelecimento
    ? `Painel ${terminologia.estabelecimento.artigo === "a" ? "da" : "do"} ${terminologia.estabelecimento.singular.toLowerCase()} ${estabelecimento.identidadeVisual.nomeCurto}`
    : `Painel ${terminologia.estabelecimento.artigo === "a" ? "da" : "do"} ${terminologia.estabelecimento.singular.toLowerCase()}`;

  const bloqueado = !carregando && estabelecimento && (estabelecimento.status === "suspenso" || estabelecimento.status === "cancelado");
  if (bloqueado && estabelecimento) {
    const feminino = terminologia.estabelecimento.artigo === "a";
    return (
      <AdminShell itens={itens} subtitulo={subtitulo}>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-danger-soft text-[color:var(--color-danger)]">
            <ShieldAlert size={28} />
          </div>
          <h1 className="text-lg font-bold text-ink">
            {terminologia.estabelecimento.singular}{" "}
            {estabelecimento.status === "suspenso" ? (feminino ? "suspensa" : "suspenso") : (feminino ? "cancelada" : "cancelado")}{" "}
            na plataforma
          </h1>
          <p className="max-w-sm text-sm text-ink-soft">
            {estabelecimento.motivoSuspensao ??
              "O acesso ao portal está temporariamente bloqueado. Fale com a administração da plataforma."}
          </p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell itens={itens} subtitulo={subtitulo}>
      {children}
    </AdminShell>
  );
}
