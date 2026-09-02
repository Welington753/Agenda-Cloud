"use client";

import { useState } from "react";
import { Plus, RotateCcw, ShieldAlert, ShieldOff, UserCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { useClientData } from "@/lib/hooks/use-client-data";
import {
  identificarProprietarioPrincipal,
  podeAlterarPapelAdministrador,
  podeAlterarStatusAdministrador,
  podeCriarAdministrador,
  podeGerenciarAdministradores,
  podeRemoverAdministrador,
} from "@/lib/access/access-control";
import { auditoriaRepository, conviteRepository, usuarioPlataformaRepository } from "@/lib/repositories";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { BadgeStatusConvite, BadgeStatusUsuario, Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ModalConvitePlataforma } from "@/components/master/modal-convite-plataforma";
import { formatarData } from "@/lib/format";
import type { PapelPlataforma, StatusUsuario } from "@/lib/types";

const ROTULO_PAPEL: Record<PapelPlataforma, string> = {
  MASTER_OWNER: "MASTER_OWNER",
  MASTER_ADMIN: "MASTER_ADMIN",
  MASTER_SUPPORT: "MASTER_SUPPORT",
};

export default function MasterAdministradoresPage() {
  const { usuario } = useAuth();
  const { notificar } = useToast();
  const [modalAberto, setModalAberto] = useState(false);

  const { dados, carregando, recarregar } = useClientData(() => ({
    usuarios: usuarioPlataformaRepository.listarTodos(),
    convites: conviteRepository.listarPlataforma(),
  }), []);

  if (carregando || !dados || !usuario) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { usuarios, convites } = dados;
  const principal = identificarProprietarioPrincipal(usuarios);
  const podeGerenciar = podeGerenciarAdministradores(usuario.papel as PapelPlataforma);

  // Toda função de mutação abaixo confere a permissão de novo, por conta própria
  // — o botão escondido na UI é só ajuda visual, nunca a proteção real. As regras
  // em si (inclusive "nunca zero MASTER_OWNER ativo") vivem em
  // src/lib/access/access-control.ts e são puras/testadas isoladamente.

  function alternarStatus(id: string, statusAtual: StatusUsuario) {
    const novoStatus: StatusUsuario = statusAtual === "ativo" ? "suspenso" : "ativo";
    const resultado = podeAlterarStatusAdministrador(usuarios, usuario!.papel as PapelPlataforma, id, novoStatus);
    if (!resultado.permitido) {
      notificar(resultado.motivo ?? "Não foi possível alterar o status.", "erro");
      return;
    }
    usuarioPlataformaRepository.atualizar(id, { status: novoStatus });
    notificar(`Administrador ${novoStatus === "ativo" ? "reativado" : "suspenso"}.`, "sucesso");
    recarregar();
  }

  function remover(id: string, nome: string) {
    const resultado = podeRemoverAdministrador(usuarios, usuario!.papel as PapelPlataforma, id);
    if (!resultado.permitido) {
      notificar(resultado.motivo ?? "Não foi possível remover este administrador.", "erro");
      return;
    }
    if (!window.confirm(`Remover o administrador "${nome}"? Essa ação não pode ser desfeita.`)) return;
    usuarioPlataformaRepository.remover(id);
    auditoriaRepository.registrar({
      acao: "master.removido",
      usuarioResponsavelId: usuario!.id,
      usuarioResponsavelNome: usuario!.nome,
      resumo: `Administrador ${nome} removido da plataforma.`,
    });
    notificar("Administrador removido.", "sucesso");
    recarregar();
  }

  function alterarPapel(id: string, novoPapel: PapelPlataforma) {
    const resultado = podeAlterarPapelAdministrador(usuarios, usuario!.papel as PapelPlataforma, id, novoPapel);
    if (!resultado.permitido) {
      notificar(resultado.motivo ?? "Não foi possível alterar o perfil.", "erro");
      return;
    }
    usuarioPlataformaRepository.atualizar(id, { papel: novoPapel, permissoesExtras: [] });
    notificar("Perfil atualizado.", "sucesso");
    recarregar();
  }

  function aceitarConvite(conviteId: string) {
    const convite = convites.find((c) => c.id === conviteId);
    if (!convite) return;
    const resultado = podeCriarAdministrador(usuario!.papel as PapelPlataforma, convite.papel as PapelPlataforma);
    if (!resultado.permitido) {
      notificar(resultado.motivo ?? "Não foi possível aceitar este convite.", "erro");
      return;
    }
    const novo = usuarioPlataformaRepository.criar({
      nome: convite.nome,
      email: convite.email,
      papel: convite.papel as PapelPlataforma,
      status: "ativo",
      permissoesExtras: [],
      criadoEm: new Date().toISOString(),
    });
    conviteRepository.atualizarStatus(convite.id, "aceito", { aceitoEm: new Date().toISOString(), usuarioIdGerado: novo.id });
    notificar(`Convite aceito (simulado). ${convite.nome} agora é administrador ativo.`, "sucesso");
    recarregar();
  }

  function reenviarConvite(conviteId: string) {
    const novo = conviteRepository.reenviar(conviteId);
    if (!novo) {
      notificar("Só é possível reenviar convites pendentes ou expirados.", "erro");
      return;
    }
    notificar("Convite reenviado — o link anterior foi invalidado.", "sucesso");
    recarregar();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warning-soft p-3 text-[color:var(--color-warning)]">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" />
        <p className="text-sm">
          Autenticação de demonstração: todas as contas usam a mesma senha simulada, sem hash nem verificação de
          servidor. Não representa segurança de produção — um backend real precisa validar credenciais e emitir
          sessão segura antes de qualquer uso real.
        </p>
      </div>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-ink">Administradores</h1>
          <p className="text-sm text-ink-soft">Quem tem acesso à administração da plataforma.</p>
        </div>
        {podeGerenciar && (
          <Botao tamanho="sm" onClick={() => setModalAberto(true)}>
            <Plus size={16} className="mr-1.5" /> Convidar administrador
          </Botao>
        )}
      </div>

      <Cartao>
        <CartaoCorpo>
          <CartaoTitulo className="mb-3">Contas</CartaoTitulo>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-ink-soft">
                  <th className="pb-2 pr-4 font-semibold">Nome</th>
                  <th className="pb-2 pr-4 font-semibold">Perfil</th>
                  <th className="pb-2 pr-4 font-semibold">Status</th>
                  <th className="pb-2 pr-4 font-semibold">Último acesso simulado</th>
                  <th className="pb-2 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {usuarios.map((u) => {
                  const ehPrincipal = principal?.id === u.id;
                  return (
                    <tr key={u.id}>
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-ink">{u.nome}</p>
                        <p className="text-xs text-ink-soft">{u.email}</p>
                      </td>
                      <td className="py-2.5 pr-4">
                        {podeGerenciar && u.papel !== "MASTER_OWNER" ? (
                          <select
                            value={u.papel}
                            onChange={(e) => alterarPapel(u.id, e.target.value as PapelPlataforma)}
                            className="rounded-[var(--radius-control)] border border-border bg-card px-2 py-1 text-xs text-ink"
                          >
                            <option value="MASTER_ADMIN">MASTER_ADMIN</option>
                            <option value="MASTER_SUPPORT">MASTER_SUPPORT</option>
                          </select>
                        ) : (
                          <Badge cor="destaque">{ROTULO_PAPEL[u.papel]}</Badge>
                        )}
                        {ehPrincipal && <p className="mt-1 text-[11px] text-ink-soft">Proprietário principal</p>}
                      </td>
                      <td className="py-2.5 pr-4">
                        <BadgeStatusUsuario status={u.status} />
                      </td>
                      <td className="py-2.5 pr-4 text-ink-soft">
                        {u.ultimoAcessoSimuladoEm ? formatarData(u.ultimoAcessoSimuladoEm) : "Nunca"}
                      </td>
                      <td className="py-2.5">
                        <div className="flex gap-2">
                          {podeGerenciar && (
                            <button
                              type="button"
                              onClick={() => alternarStatus(u.id, u.status)}
                              className="text-xs font-semibold text-accent hover:underline"
                            >
                              {u.status === "ativo" ? "Suspender" : "Reativar"}
                            </button>
                          )}
                          {podeGerenciar && !ehPrincipal && (
                            <button
                              type="button"
                              onClick={() => remover(u.id, u.nome)}
                              className="text-xs font-semibold text-[color:var(--color-danger)] hover:underline"
                            >
                              Remover
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo>
          <CartaoTitulo className="mb-3">Convites</CartaoTitulo>
          {convites.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhum convite de administrador ainda.</p>
          ) : (
            <ul className="divide-y divide-border">
              {convites.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{c.nome}</p>
                    <p className="text-xs text-ink-soft">
                      {c.email} · {ROTULO_PAPEL[c.papel as PapelPlataforma]} · expira em {formatarData(c.expiraEm)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <BadgeStatusConvite status={c.status} />
                    {c.status === "pendente" && (
                      <button
                        type="button"
                        onClick={() => aceitarConvite(c.id)}
                        className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                      >
                        <UserCheck size={14} /> Aceitar (simular)
                      </button>
                    )}
                    {(c.status === "pendente" || c.status === "expirado") && (
                      <button
                        type="button"
                        onClick={() => reenviarConvite(c.id)}
                        className="flex items-center gap-1 text-xs font-semibold text-ink-soft hover:underline"
                      >
                        <RotateCcw size={14} /> Reenviar
                      </button>
                    )}
                    {c.status === "revogado" && <ShieldOff size={14} className="text-ink-soft" />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CartaoCorpo>
      </Cartao>

      {podeGerenciar && (
        <ModalConvitePlataforma
          aberto={modalAberto}
          aoFechar={() => setModalAberto(false)}
          responsavelId={usuario.id}
          responsavelNome={usuario.nome}
          responsavelPapel={usuario.papel as PapelPlataforma}
          onCriado={recarregar}
        />
      )}
    </div>
  );
}
