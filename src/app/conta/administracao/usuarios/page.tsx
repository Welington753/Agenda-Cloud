"use client";

// Todas as contas que entram no sistema (não os clientes da agenda):
// antigas, administradores, sem estabelecimento e pendentes. Busca por nome
// ou e-mail, filtros por situação, estabelecimento e papel. Os contadores são
// do conjunto filtrado inteiro (sem o filtro de situação, que eles
// detalham), nunca da página carregada.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Search, UserCheck, UserX, Users, Clock3 } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-base";
import { EstatisticaCard } from "@/components/ui/estatistica-card";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehListaUsuarios, ehOpcoesEstabelecimento } from "@/lib/administracao/contas";
import { PAPEIS_ESTABELECIMENTO, PAPEIS_PLATAFORMA, SITUACOES_CONTA, corConta, dataHora } from "@/lib/administracao/rotulos";
import { rotaFichaUsuario } from "@/lib/administracao/rotas";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm";
const VAZIO = { q: "", status: "", tenantId: "", platformRole: "", page: 1 };

export default function UsuariosPage() {
  const [form, setForm] = useState(VAZIO);
  const [filtro, setFiltro] = useState(VAZIO);
  const [erroBusca, setErroBusca] = useState("");
  const params = new URLSearchParams({ page: String(filtro.page), pageSize: "20" });
  for (const chave of ["q", "status", "tenantId", "platformRole"] as const) if (filtro[chave]) params.set(chave, filtro[chave]);
  const { estado, recarregar } = useLeituraPlataforma(`/platform/users?${params}`, ehListaUsuarios);
  const opcoes = useLeituraPlataforma("/platform/establishment-options", ehOpcoesEstabelecimento);

  function pesquisar(evento: FormEvent) {
    evento.preventDefault();
    if (form.q.trim().length === 1) {
      setErroBusca("Digite ao menos 2 caracteres ou deixe a busca vazia.");
      return;
    }
    setErroBusca("");
    setFiltro({ ...form, q: form.q.trim(), page: 1 });
  }
  const campo = (nome: "q" | "status" | "tenantId" | "platformRole") => ({
    value: form[nome],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [nome]: e.target.value })),
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usuários</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">
            Contas com acesso ao sistema. Clientes que marcam horário ficam na agenda de cada estabelecimento e não
            aparecem aqui.
          </p>
        </div>
        <Botao variante="secundaria" onClick={recarregar} className="min-h-11">
          Atualizar
        </Botao>
      </header>
      {estado.status === "pronto" && (
        <section aria-label="Resumo das contas encontradas" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <EstatisticaCard icone={Users} rotulo="No conjunto" valor={String(estado.dados.summary.total)} />
          <EstatisticaCard icone={UserCheck} rotulo="Ativas" valor={String(estado.dados.summary.active)} corIcone="success" />
          <EstatisticaCard icone={Clock3} rotulo="Aguardando ativação" valor={String(estado.dados.summary.invited)} corIcone="info" />
          <EstatisticaCard icone={UserX} rotulo="Bloqueadas" valor={String(estado.dados.summary.suspended)} corIcone="warning" />
        </section>
      )}
      <form onSubmit={pesquisar} className="grid items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <label className="min-w-0 text-sm font-medium">
          Buscar por nome ou e-mail
          <input className={CAMPO} maxLength={120} {...campo("q")} />
        </label>
        <label className="min-w-0 text-sm font-medium">
          Situação da conta
          <select className={CAMPO} {...campo("status")}>
            <option value="">Todas</option>
            {Object.entries(SITUACOES_CONTA).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Estabelecimento
          <select className={CAMPO} {...campo("tenantId")} disabled={opcoes.estado.status !== "pronto"}>
            <option value="">Todos</option>
            {opcoes.estado.status === "pronto" &&
              opcoes.estado.dados.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Papel na plataforma
          <select className={CAMPO} {...campo("platformRole")}>
            <option value="">Todos</option>
            <option value="NONE">Sem papel de plataforma</option>
            {Object.keys(PAPEIS_PLATAFORMA).map((valor) => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </select>
        </label>
        <Botao type="submit" className="min-h-11">
          <Search size={17} aria-hidden="true" />
          Pesquisar
        </Botao>
      </form>
      {erroBusca && (
        <p role="alert" className="text-sm text-danger">
          {erroBusca}
        </p>
      )}
      {estado.status !== "pronto" ? (
        <EstadoLeitura estado={estado} recarregar={recarregar} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-ink-soft">
              {estado.dados.total} conta(s) encontrada(s)
            </p>
            <Botao
              variante="fantasma"
              className="min-h-11"
              onClick={() => {
                setForm(VAZIO);
                setFiltro(VAZIO);
              }}
            >
              Limpar filtros
            </Botao>
          </div>
          {estado.dados.items.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-8 text-center text-ink-soft">Nenhuma conta encontrada.</p>
          ) : (
            <ul className="space-y-3" data-testid="lista-usuarios">
              {estado.dados.items.map((u) => (
                <li key={u.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={rotaFichaUsuario(u.id)} className="inline-flex min-h-11 items-center break-words font-semibold hover:text-accent">
                        {u.name}
                      </Link>
                      <p className="break-all text-sm text-ink-soft">{u.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge cor={corConta(u.status)}>{SITUACOES_CONTA[u.status]}</Badge>
                      {u.platformRole && <Badge cor="destaque">{u.platformRole}</Badge>}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-ink-soft">
                    E-mail {u.emailVerified ? "verificado" : "não verificado"} · criada em {dataHora(u.createdAt)}
                    {u.status === "ACTIVE" && !u.hasPassword ? " · sem senha" : ""}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {u.memberships.length === 0
                      ? "Sem estabelecimento"
                      : u.memberships.map((m) => `${m.tenantName} (${PAPEIS_ESTABELECIMENTO[m.role] ?? m.role})`).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
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
    </div>
  );
}
