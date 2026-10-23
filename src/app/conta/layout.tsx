"use client";

// Portal da conta REAL (Lote 6C.1) — separado por inteiro de `/painel`,
// `/master` e `/profissional` (todos ainda 100% demonstrativos, movidos pelos
// repositórios locais). Nenhuma página sob `/conta` importa
// `@/lib/repositories` nem `@/lib/auth/auth-context` — nem indiretamente
// (ver lib/servicos/sem-dados-demo.test.ts).
//
// A estrutura comum (menu lateral no computador, barras no celular, ver
// components/conta/shell-conta.tsx) só aparece DEPOIS de `RequireRealSession`
// confirmar a sessão: sem sessão, a pessoa vai para o login sem ver menu
// nenhum.
//
// `SolicitacoesProvider` fica entre os dois: é a ÚNICA leitura periódica das
// solicitações pendentes (contador do menu, avisos de novas solicitações,
// Visão geral e tela de Solicitações usam a mesma lista).
//
// `AcessoPlataformaProvider` lê uma vez se a pessoa administra a plataforma:
// o menu mostra "Administração" e as páginas de `/conta/administracao` usam a
// mesma resposta (o servidor autoriza de novo cada leitura).
import type { ReactNode } from "react";
import { RequireRealSession } from "@/components/auth/require-real-session";
import { ShellConta } from "@/components/conta/shell-conta";
import { SolicitacoesProvider } from "@/lib/agendamento-publico/use-solicitacoes";
import { MarcadorAparencia } from "@/components/aparencia/aparencia";
import { AcessoPlataformaProvider } from "@/lib/administracao/use-acesso-plataforma";

export default function ContaLayout({ children }: { children: ReactNode }) {
  // Área real adaptável: claro, escuro ou seguir aparelho (menu da conta).
  return (
    <>
      <MarcadorAparencia />
      <RequireRealSession>
        <AcessoPlataformaProvider>
          <SolicitacoesProvider>
            <ShellConta>{children}</ShellConta>
          </SolicitacoesProvider>
        </AcessoPlataformaProvider>
      </RequireRealSession>
    </>
  );
}
