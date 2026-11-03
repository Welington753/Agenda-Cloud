"use client";

// Histórico administrativo (`audit_logs`): quem fez, o quê, em quem, em qual
// estabelecimento e quando. Mais recentes primeiro. Filtro por ação e, vindo
// da ficha de um usuário, pela conta (como alvo ou como autora).
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Botao } from "@/components/ui/button";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehListaHistorico } from "@/lib/administracao/contas";
import { ACOES_HISTORICO, dataHora } from "@/lib/administracao/rotulos";
import { ROTA_HISTORICO, rotaFichaEstabelecimento, rotaFichaUsuario } from "@/lib/administracao/rotas";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

function Historico() {
  const busca = useSearchParams();
  const conta = busca.get("targetUserId") ?? "";
  const [acao, setAcao] = useState("");
  const [pagina, setPagina] = useState(1);
  const params = new URLSearchParams({ page: String(pagina), pageSize: "20" });
  if (acao) params.set("action", acao);
  if (/^[a-zA-Z0-9_-]{1,30}$/.test(conta)) params.set("targetUserId", conta);
  const { estado, recarregar } = useLeituraPlataforma(`/platform/audit?${params}`, ehListaHistorico);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Histórico administrativo</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">
            Registrado na mesma transação de cada mudança. Nunca guarda senha, token ou link.
          </p>
          {conta && (
            <p className="mt-2 text-sm">
              Só uma conta.{" "}
              <Link href={ROTA_HISTORICO} className="font-medium text-accent hover:underline">
                Ver tudo
              </Link>
            </p>
          )}
        </div>
        <Botao variante="secundaria" onClick={recarregar} className="min-h-11">
          Atualizar
        </Botao>
      </header>
      <label className="block max-w-sm text-sm font-medium">
        Ação
        <select
          className={CAMPO}
          value={acao}
          onChange={(e) => {
            setAcao(e.target.value);
            setPagina(1);
          }}
        >
          <option value="">Todas</option>
          {Object.entries(ACOES_HISTORICO).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </select>
      </label>
      {estado.status !== "pronto" ? (
        <EstadoLeitura estado={estado} recarregar={recarregar} />
      ) : (
        <>
          <p role="status" className="text-sm text-ink-soft">
            {estado.dados.total} registro(s)
          </p>
          <ol className="space-y-3" data-testid="historico">
            {estado.dados.items.map((r) => (
              <li key={r.id} className="space-y-1 rounded-xl border border-border bg-card p-4 text-sm">
                <p className="font-semibold">{ACOES_HISTORICO[r.action] ?? r.action}</p>
                <p className="break-words">{r.summary}</p>
                <p className="text-xs text-ink-soft">
                  {dataHora(r.occurredAt)} · por {r.actor.name}
                  {r.target && (
                    <>
                      {" "}
                      · conta{" "}
                      <Link href={rotaFichaUsuario(r.target.id)} className="text-accent hover:underline">
                        {r.target.name}
                      </Link>
                    </>
                  )}
                  {r.tenant && (
                    <>
                      {" "}
                      · em{" "}
                      <Link href={rotaFichaEstabelecimento(r.tenant.id)} className="text-accent hover:underline">
                        {r.tenant.name}
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
          <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-2">
            <Botao variante="secundaria" disabled={pagina === 1} onClick={() => setPagina((p) => p - 1)} className="min-h-11">
              Anterior
            </Botao>
            <span className="text-sm text-ink-soft">
              Página {pagina} de {Math.max(1, Math.ceil(estado.dados.total / estado.dados.pageSize))}
            </span>
            <Botao
              variante="secundaria"
              disabled={pagina * estado.dados.pageSize >= estado.dados.total}
              onClick={() => setPagina((p) => p + 1)}
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

export default function HistoricoPage() {
  return (
    <Suspense fallback={null}>
      <Historico />
    </Suspense>
  );
}
