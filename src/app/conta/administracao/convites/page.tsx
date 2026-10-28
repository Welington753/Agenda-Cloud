"use client";

// Todos os convites: pendente, aceito, expirado e revogado, com o estado do
// envio do e-mail separado do estado do convite. Os contadores são do
// conjunto filtrado inteiro. Reenviar e revogar ficam em cada linha.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { SituacaoDoConvite } from "@/components/administracao/estado-envio";
import { AcoesConvite } from "@/components/administracao/acoes-convite";
import { ConvidarAdministrador } from "@/components/administracao/convidar-administrador";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { useCapacidades } from "@/lib/administracao/use-acesso-plataforma";
import { ehListaConvites } from "@/lib/administracao/contas";
import { PAPEIS_ESTABELECIMENTO, SITUACOES_CONVITE, dataHora } from "@/lib/administracao/rotulos";
import { rotaFichaUsuario } from "@/lib/administracao/rotas";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";
const VAZIO = { q: "", status: "", page: 1 };

export default function ConvitesPage() {
  const capacidades = useCapacidades();
  const [form, setForm] = useState(VAZIO);
  const [filtro, setFiltro] = useState(VAZIO);
  const params = new URLSearchParams({ page: String(filtro.page), pageSize: "20" });
  if (filtro.q) params.set("q", filtro.q);
  if (filtro.status) params.set("status", filtro.status);
  const { estado, recarregar } = useLeituraPlataforma(`/platform/invites?${params}`, ehListaConvites);

  function pesquisar(evento: FormEvent) {
    evento.preventDefault();
    setFiltro({ ...form, q: form.q.trim().length >= 2 ? form.q.trim() : "", page: 1 });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Convites</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">
            Cada link vale 24 horas e só uma vez. &quot;Aceito pelo provedor&quot; quer dizer que o e-mail saiu, não que a
            pessoa abriu.
          </p>
        </div>
        <Botao variante="secundaria" onClick={recarregar} className="min-h-11">
          Atualizar
        </Botao>
      </header>
      {estado.status === "pronto" && (
        <p className="text-sm" aria-label="Resumo dos convites encontrados">
          {estado.dados.summary.pending} pendente(s) · {estado.dados.summary.accepted} aceito(s) · {estado.dados.summary.expired}{" "}
          expirado(s) · {estado.dados.summary.revoked} revogado(s)
          {estado.dados.summary.deliveryProblems > 0 && ` · ${estado.dados.summary.deliveryProblems} pendente(s) sem envio confirmado`}
        </p>
      )}
      <form onSubmit={pesquisar} className="grid items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[2fr_1fr_auto]">
        <label className="min-w-0 text-sm font-medium">
          Buscar por nome ou e-mail
          <input className={CAMPO} maxLength={120} value={form.q} onChange={(e) => setForm((f) => ({ ...f, q: e.target.value }))} />
        </label>
        <label className="min-w-0 text-sm font-medium">
          Situação
          <select className={CAMPO} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Todas</option>
            {Object.entries(SITUACOES_CONVITE).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <Botao type="submit" className="min-h-11">
          <Search size={17} aria-hidden="true" />
          Pesquisar
        </Botao>
      </form>
      {estado.status !== "pronto" ? (
        <EstadoLeitura estado={estado} recarregar={recarregar} />
      ) : (
        <>
          <p role="status" className="text-sm text-ink-soft">
            {estado.dados.total} convite(s) encontrado(s)
          </p>
          <ul className="space-y-3" data-testid="lista-convites">
            {estado.dados.items.map((convite) => (
              <li key={convite.id} className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {convite.targetUser ? (
                      <Link href={rotaFichaUsuario(convite.targetUser.id)} className="inline-flex min-h-11 items-center font-semibold hover:text-accent">
                        {convite.targetName}
                      </Link>
                    ) : (
                      <p className="font-semibold">{convite.targetName}</p>
                    )}
                    <p className="break-all text-ink-soft">{convite.targetEmail}</p>
                  </div>
                  <SituacaoDoConvite convite={convite} />
                </div>
                <p className="text-xs text-ink-soft">
                  {convite.tenant
                    ? `${PAPEIS_ESTABELECIMENTO[convite.role ?? ""] ?? convite.role} em ${convite.tenant.name}`
                    : `Administração da plataforma (${convite.platformRole})`}{" "}
                  · por {convite.createdBy.name} em {dataHora(convite.createdAt)}
                </p>
                {(convite.type === "PLATFORM" ? capacidades.managePlatformAccess : capacidades.manageEstablishments) && (
                  <AcoesConvite convite={convite} aoMudar={recarregar} />
                )}
              </li>
            ))}
          </ul>
          <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-2">
            <Botao variante="secundaria" disabled={filtro.page === 1} onClick={() => setFiltro((f) => ({ ...f, page: f.page - 1 }))} className="min-h-11">
              Anterior
            </Botao>
            <span className="text-sm text-ink-soft">
              Página {filtro.page} de {Math.max(1, Math.ceil(estado.dados.total / estado.dados.pageSize))}
            </span>
            <Botao
              variante="secundaria"
              disabled={filtro.page * estado.dados.pageSize >= estado.dados.total}
              onClick={() => setFiltro((f) => ({ ...f, page: f.page + 1 }))}
              className="min-h-11"
            >
              Próxima
            </Botao>
          </nav>
        </>
      )}
      {capacidades.managePlatformAccess && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <h2 className="font-semibold">Convidar para a administração da plataforma</h2>
            <ConvidarAdministrador aoConvidar={recarregar} />
          </CartaoCorpo>
        </Cartao>
      )}
    </div>
  );
}
