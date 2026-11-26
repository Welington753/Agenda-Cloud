"use client";

// Ficha do cliente (`/conta/clientes/[id]`): dados, resumo "neste cadastro",
// histórico paginado, outros cadastros sugeridos, edição e unificação (só o
// dono). Área REAL: nada da demonstração é importado.
//
// - Os números são deste cadastro; nada é somado entre cadastros.
// - Nomes diferentes nos agendamentos geram o aviso de histórico
//   possivelmente compartilhado.
// - Preço e recebimento só aparecem para quem pode ver (o servidor recorta).
// - Cadastro unificado: a ficha leva ao principal.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Mail, MessageCircle, Pencil, Users } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import type { ItemDoHistorico, OutroCadastro } from "@/lib/api/consumers-api";
import {
  AVISO_HISTORICO_COMPARTILHADO,
  ROTULO_RELACAO,
  dataEHora,
  linhasDoResumo,
  mensagemFalhaFicha,
  podeEditarClientes,
  podeUnificarClientes,
} from "@/lib/clientes/ficha";
import { mensagemFalhaBusca } from "@/lib/clientes/cadastro";
import { useFichaDoCliente } from "@/lib/clientes/use-ficha-do-cliente";
import { ROTULO_STATUS } from "@/lib/profissionais/agendamentos";
import { ROTA_CLIENTES, rotaDaFichaDoCliente } from "@/lib/conta/rotas";
import { formatarMoeda } from "@/lib/format";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { LinkWhatsappCliente } from "@/components/conta/contato-whatsapp";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EdicaoCliente } from "./edicao-cliente";
import { UnificacaoClientes } from "./unificacao-clientes";
import { ComprasDoCliente } from "./compras-do-cliente";
import { useAreas } from "@/lib/conta/use-areas";

function rotuloDoStatus(status: string): string {
  return (ROTULO_STATUS as Record<string, string>)[status] ?? status;
}

function LinhaDoHistorico({ item }: { item: ItemDoHistorico }) {
  return (
    <li className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-ink">
          {dataEHora(item.localDate, item.localStart)} · {rotuloDoStatus(item.status)}
        </p>
        <p className="break-words text-ink-soft">
          {item.services.join(", ") || "Serviço"} com {item.professionalName}
        </p>
      </div>
      <div className="shrink-0 text-sm text-ink-soft sm:text-right">
        {!item.hidden.includes("price") && <p>{item.priceCents === null ? "Sob consulta" : formatarMoeda(item.priceCents)}</p>}
        {item.payment && (
          <p>
            {item.payment.refunded ? "Recebimento estornado" : `Recebido ${formatarMoeda(item.payment.amountCents)}`}
          </p>
        )}
      </div>
    </li>
  );
}

export default function FichaDoClientePage() {
  const { estado: sessao } = useRealAuth();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const contexto = sessao.status === "autenticado" && tenantId ? encontrarContextoPorTenantId(sessao.sessao, tenantId) : null;
  const { ficha, historico, recarregar, carregarMais } = useFichaDoCliente(tenantId, id ?? null);
  const [editando, setEditando] = useState(false);
  const [unificarCom, setUnificarCom] = useState<OutroCadastro | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Compras: consulta geral de vendas e clientes (o servidor confere de novo).
  const tem = useAreas();
  const verCompras = tem("VENDAS_VER_TODAS") && tem("CLIENTES_VER");

  // Trocar de estabelecimento ou de cliente fecha o que estava aberto.
  useEffect(() => {
    setEditando(false);
    setUnificarCom(null);
    setAviso(null);
  }, [tenantId, id]);

  if (sessao.status !== "autenticado" || !tenantId) return null;
  const podeEditar = podeEditarClientes(contexto);
  const podeUnificar = podeUnificarClientes(contexto);
  const voltar = { href: ROTA_CLIENTES, rotulo: "Voltar a Clientes" };

  if (ficha.status === "carregando") {
    return (
      <PaginaConta titulo="Cliente" voltar={voltar}>
        <div aria-busy="true" className="space-y-3" data-testid="ficha-carregando">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PaginaConta>
    );
  }

  if (ficha.status === "falha") {
    const principalId = ficha.falha.tipo === "cliente_unificado" ? ficha.falha.principalId : null;
    return (
      <PaginaConta titulo="Cliente" voltar={voltar}>
        <Cartao>
          <CartaoCorpo className="space-y-3" data-testid="ficha-falha">
            <p role="alert" className="text-sm text-ink">
              {mensagemFalhaFicha(ficha.falha)}
            </p>
            {principalId ? (
              <Link href={rotaDaFichaDoCliente(principalId)} className="text-sm font-medium text-[color:var(--color-accent-hover)] underline" data-testid="abrir-principal">
                Abrir o cadastro principal
              </Link>
            ) : (
              ficha.falha.tipo !== "sem_acesso" &&
              ficha.falha.tipo !== "sem_permissao" && (
                <Botao type="button" onClick={recarregar}>
                  Tentar novamente
                </Botao>
              )
            )}
          </CartaoCorpo>
        </Cartao>
      </PaginaConta>
    );
  }

  const { consumer, resumo, nomesUsados, historicoPossivelmenteCompartilhado, outrosCadastros } = ficha.ficha;

  return (
    <PaginaConta
      titulo={consumer.name}
      descricao="Os números desta ficha são deste cadastro."
      voltar={voltar}
      acoes={
        podeEditar && !editando && !unificarCom ? (
          <Botao type="button" variante="secundaria" onClick={() => setEditando(true)} data-testid="ficha-editar">
            <Pencil size={16} aria-hidden="true" />
            Editar
          </Botao>
        ) : undefined
      }
    >
      {aviso && (
        <p role="status" className="rounded-[var(--radius-card)] border border-border bg-card p-3 text-sm text-ink" data-testid="ficha-aviso">
          {aviso}
        </p>
      )}

      <Cartao>
        <CartaoCorpo className="space-y-3">
          {editando ? (
            <EdicaoCliente
              tenantId={tenantId}
              cliente={consumer}
              aoCancelar={() => setEditando(false)}
              aoRecarregar={() => {
                setEditando(false);
                recarregar();
              }}
              aoSalvar={() => {
                setEditando(false);
                setAviso("Cadastro atualizado. O histórico continua neste cadastro.");
                recarregar();
              }}
            />
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid="ficha-dados">
              <div className="min-w-0 space-y-1 text-sm text-ink-soft">
                <p className="inline-flex items-center gap-1.5">
                  <MessageCircle size={14} aria-hidden="true" />
                  {consumer.whatsapp}
                </p>
                {consumer.email && (
                  <p className="flex min-w-0 items-center gap-1.5">
                    <Mail size={14} aria-hidden="true" className="shrink-0" />
                    <span className="break-all">{consumer.email}</span>
                  </p>
                )}
              </div>
              <LinkWhatsappCliente nome={consumer.name} telefone={consumer.whatsapp} className="self-start sm:self-auto" />
            </div>
          )}
          {!consumer.telefoneAgrupavel && (
            <p className="text-xs text-ink-soft" data-testid="ficha-telefone-fora-do-padrao">
              Este WhatsApp não está num formato reconhecido, então cadastros parecidos não são sugeridos. Confira o número.
            </p>
          )}
        </CartaoCorpo>
      </Cartao>

      {historicoPossivelmenteCompartilhado && (
        <div role="note" className="flex items-start gap-2 rounded-[var(--radius-card)] border border-border bg-card p-3 text-sm text-ink" data-testid="aviso-historico-compartilhado">
          <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--color-danger)]" />
          <div>
            <p>{AVISO_HISTORICO_COMPARTILHADO}</p>
            <p className="mt-1 text-ink-soft">Nomes usados: {nomesUsados.join(", ")}.</p>
          </div>
        </div>
      )}

      <Cartao>
        <CartaoCorpo className="space-y-3" data-testid="ficha-resumo">
          <h2 className="text-sm font-semibold text-ink">Neste cadastro</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
            {linhasDoResumo(resumo).map((linha) => (
              <li key={linha}>{linha}</li>
            ))}
          </ul>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-soft">Último atendimento concluído</dt>
              <dd className="text-ink">
                {resumo.ultimoConcluido
                  ? `${dataEHora(resumo.ultimoConcluido.localDate, resumo.ultimoConcluido.localStart)} · ${resumo.ultimoConcluido.services.join(", ")} com ${resumo.ultimoConcluido.professionalName}`
                  : "Nenhum ainda"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">Próximo agendamento</dt>
              <dd className="text-ink">
                {resumo.proximo
                  ? `${dataEHora(resumo.proximo.localDate, resumo.proximo.localStart)} · ${resumo.proximo.services.join(", ")} com ${resumo.proximo.professionalName}`
                  : "Nenhum marcado"}
              </dd>
            </div>
          </dl>
        </CartaoCorpo>
      </Cartao>

      {outrosCadastros.length > 0 && (
        <Cartao>
          <CartaoCorpo className="space-y-3" data-testid="outros-cadastros">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
              <Users size={16} aria-hidden="true" />
              Cadastros parecidos — confira
            </h2>
            <p className="text-xs text-ink-soft">Só sugestões: nada é unificado sem a sua confirmação.</p>
            <ul className="space-y-2">
              {outrosCadastros.map((outro) => (
                <li key={outro.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border p-3" data-testid="outro-cadastro">
                  <div className="min-w-0 text-sm">
                    <Link href={rotaDaFichaDoCliente(outro.id)} className="font-semibold break-words text-ink underline-offset-2 hover:underline">
                      {outro.name}
                    </Link>
                    <p className="text-ink-soft">{outro.whatsapp}</p>
                    <p className="text-xs text-ink-soft">{outro.relacoes.map((r) => ROTULO_RELACAO[r]).join(" · ")}</p>
                  </div>
                  {podeUnificar && !unificarCom && !editando && (
                    <Botao type="button" variante="secundaria" tamanho="sm" onClick={() => setUnificarCom(outro)} data-testid="unificar-com">
                      Unificar cadastros
                    </Botao>
                  )}
                </li>
              ))}
            </ul>
          </CartaoCorpo>
        </Cartao>
      )}

      {unificarCom && (
        <Cartao>
          <CartaoCorpo>
            <UnificacaoClientes
              tenantId={tenantId}
              esteCadastro={consumer}
              outroCadastro={unificarCom}
              aoCancelar={() => setUnificarCom(null)}
              aoConcluir={(resultado) => {
                setUnificarCom(null);
                if (resultado.principal.id !== consumer.id) {
                  router.replace(rotaDaFichaDoCliente(resultado.principal.id));
                } else {
                  setAviso("Cadastros unificados. O histórico agora está neste cadastro.");
                  recarregar();
                }
              }}
            />
          </CartaoCorpo>
        </Cartao>
      )}

      {verCompras && tenantId && <ComprasDoCliente tenantId={tenantId} consumerId={consumer.id} />}

      <Cartao>
        <CartaoCorpo className="space-y-2" data-testid="ficha-historico">
          <h2 className="text-sm font-semibold text-ink">Histórico neste cadastro</h2>
          {historico.status === "carregando" && <Skeleton className="h-16 w-full" />}
          {historico.status === "falha" && (
            <p role="alert" className="text-sm text-ink">
              {mensagemFalhaBusca(historico.falha)}
            </p>
          )}
          {historico.status === "pronto" && historico.itens.length === 0 && <p className="text-sm text-ink-soft">Nenhum agendamento neste cadastro.</p>}
          {historico.status === "pronto" && historico.itens.length > 0 && (
            <>
              <ul>
                {historico.itens.map((item) => (
                  <LinhaDoHistorico key={item.id} item={item} />
                ))}
              </ul>
              {historico.falhaAoCarregarMais && (
                <p role="alert" className="text-sm text-ink">
                  {mensagemFalhaBusca(historico.falhaAoCarregarMais)}
                </p>
              )}
              {historico.proximoCursor && (
                <Botao type="button" variante="secundaria" onClick={carregarMais} disabled={historico.carregandoMais} aria-busy={historico.carregandoMais} data-testid="historico-carregar-mais">
                  {historico.carregandoMais ? "Carregando..." : "Ver mais antigos"}
                </Botao>
              )}
            </>
          )}
        </CartaoCorpo>
      </Cartao>
    </PaginaConta>
  );
}
