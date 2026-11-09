"use client";

// Aplicação de comissão em massa (dono): uma regra geral para vários
// profissionais ativos de uma vez, com prévia antes de gravar. PRESERVAR (o
// padrão) só completa quem recebe comissão sem regra geral; SUBSTITUIR troca
// a regra geral de todos e liga "Recebe comissão", com confirmação
// explícita. Comissões já apuradas não mudam. Exceções por serviço ficam,
// a não ser que, em SUBSTITUIR, o dono escolha removê-las: a prévia mostra
// quem perde quais exceções e a remoção pede uma segunda confirmação. O
// servidor decide o resultado de cada profissional e recusa (409) se algo
// (inclusive uma exceção) mudou desde a prévia; aí a prévia é refeita e
// revisada de novo. Ver docs/plans/comissoes-aplicacao-em-massa.md.
import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useAreas } from "@/lib/conta/use-areas";
import { ROTA_PROFISSIONAIS } from "@/lib/conta/rotas";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import {
  caminhoEmMassa,
  caminhoPreviaEmMassa,
  ehAplicacaoEmMassa,
  ehPreviaEmMassa,
  type AlcanceEmMassa,
  type EscolhaDeExcecoes,
  type ModoEmMassa,
  type PreviaEmMassa,
} from "@/lib/api/comissoes-em-massa-api";
import {
  ROTULO_MODO,
  ROTULO_RESULTADO_APLICADO,
  ROTULO_RESULTADO_PREVIA,
  corpoDaAplicacao,
  mensagemDoConflito,
  montarPedido,
  rotuloDoBotaoAplicar,
  type PedidoEmMassa,
} from "@/lib/profissionais/comissao-em-massa";
import { AVISO_SUBSTITUIR_NAO_REMOVE } from "@/lib/profissionais/excecoes-de-comissao";
import { useProfissionaisReais } from "@/lib/profissionais/use-profissionais-reais";
import { EscolhaDasExcecoes } from "@/components/conta/escolha-de-excecoes";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { CAMPO } from "../[professionalId]/comissoes/cartao-recebe-comissao";
import { EscolhaDeAlcance } from "./escolha-de-alcance";
import { AvisoDoQueNaoMuda, ConfirmacaoDeSubstituicao, Contadores, ListaDeProfissionais, RemocaoNaPrevia } from "./previa-em-massa";

const OPCAO = "flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border p-3 text-sm text-ink";

/** A remoção pede confirmação própria quando há exceção a remover. */
const falta = (dados: PreviaEmMassa, pedido: PedidoEmMassa) => pedido.exceptions === "REMOVE" && dados.summary.exceptionsRemoved > 0;

export default function ComissaoEmMassaPage() {
  const { estado: sessao } = useRealAuth();
  const tem = useAreas();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const pode = tem("COMISSOES_CONFIGURAR");
  if (sessao.status !== "autenticado" || !tenantId) return null;

  return (
    <PaginaConta
      titulo="Aplicar comissão a vários profissionais"
      descricao="Defina uma regra geral e confira, antes de gravar, o que muda para cada profissional ativo."
      voltar={{ href: ROTA_PROFISSIONAIS, rotulo: "Voltar a Profissionais" }}
    >
      {pode ? (
        <AplicacaoEmMassa key={tenantId} tenantId={tenantId} />
      ) : (
        <Cartao>
          <CartaoCorpo>
            <p role="alert" className="text-sm text-ink">
              Sua conta não pode configurar comissões neste estabelecimento, ou o plano não inclui comissões.
            </p>
          </CartaoCorpo>
        </Cartao>
      )}
    </PaginaConta>
  );
}

function AplicacaoEmMassa({ tenantId }: { tenantId: string }) {
  const { notificar } = useToast();
  const { estado } = useProfissionaisReais(tenantId);
  const ativos = estado.status === "carregada" ? estado.profissionais.filter((p) => p.active) : [];

  const [alcance, setAlcance] = useState<AlcanceEmMassa>("ALL");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [tipo, setTipo] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [valor, setValor] = useState("");
  const [modo, setModo] = useState<ModoEmMassa>("PRESERVE");
  const [excecoes, setExcecoes] = useState<EscolhaDeExcecoes>("KEEP");
  const [previa, setPrevia] = useState<{ pedido: PedidoEmMassa; dados: PreviaEmMassa } | null>(null);
  const [resultado, setResultado] = useState<PreviaEmMassa | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [confirmadoRemocao, setConfirmadoRemocao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /** Qualquer mudança no formulário invalida a prévia e o resultado. */
  function mudou<T>(definir: (v: T) => void) {
    return (v: T) => {
      definir(v);
      setPrevia(null);
      setResultado(null);
      setConfirmado(false);
      setConfirmadoRemocao(false);
      setErro(null);
      setAviso(null);
    };
  }

  async function buscarPrevia(pedido: PedidoEmMassa): Promise<boolean> {
    const r = await acaoAdministrativa<unknown>(caminhoPreviaEmMassa(tenantId), "POST", pedido);
    if (r.tipo !== "ok") {
      setPrevia(null);
      setErro(r.tipo === "conflito" ? mensagemDoConflito(r.codigo, r.mensagem) : mensagemDoResultado(r));
      return false;
    }
    if (!ehPreviaEmMassa(r.dados)) {
      setErro("O servidor respondeu num formato inesperado. Atualize a página.");
      return false;
    }
    setPrevia({ pedido, dados: r.dados });
    setConfirmado(false);
    setConfirmadoRemocao(false);
    return true;
  }

  async function verPrevia(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    const montado = montarPedido({ alcance, selecionados, tipo, valor, modo, excecoes });
    if (!montado.ok) return setErro(montado.erro);
    setErro(null);
    setAviso(null);
    setResultado(null);
    setOcupado(true);
    await buscarPrevia(montado.pedido);
    setOcupado(false);
  }

  async function aplicar() {
    if (!previa || ocupado) return;
    if (previa.pedido.mode === "REPLACE" && !confirmado) return setErro("Confirme a substituição para aplicar.");
    if (falta(previa.dados, previa.pedido) && !confirmadoRemocao) return setErro("Confirme a remoção das exceções para aplicar.");
    setErro(null);
    setAviso(null);
    setOcupado(true);
    const r = await acaoAdministrativa<unknown>(caminhoEmMassa(tenantId), "POST", corpoDaAplicacao(previa.pedido, previa.dados));
    if (r.tipo === "conflito" && r.codigo === "PREVIA_DESATUALIZADA") {
      // Algo mudou desde a prévia: mostra a prévia de agora para nova revisão.
      const atualizada = await buscarPrevia(previa.pedido);
      if (atualizada) setAviso(mensagemDoConflito(r.codigo, r.mensagem));
      setOcupado(false);
      return;
    }
    setOcupado(false);
    if (r.tipo !== "ok") return setErro(r.tipo === "conflito" ? mensagemDoConflito(r.codigo, r.mensagem) : mensagemDoResultado(r));
    if (!ehAplicacaoEmMassa(r.dados)) return setErro("O servidor respondeu num formato inesperado. Atualize a página.");
    setResultado(r.dados);
    setPrevia(null);
    setConfirmado(false);
    setConfirmadoRemocao(false);
    const n = r.dados.summary.change;
    notificar(n === 1 ? "Comissão aplicada a 1 profissional." : `Comissão aplicada a ${n} profissionais.`, "sucesso");
  }

  if (estado.status === "carregando") return <Skeleton className="h-64 w-full" />;
  if (estado.status === "falha") {
    return (
      <Cartao>
        <CartaoCorpo>
          <p role="alert" className="text-sm text-ink">
            Não foi possível carregar os profissionais. Atualize a página.
          </p>
        </CartaoCorpo>
      </Cartao>
    );
  }

  const alternar = (id: string, marcado: boolean) =>
    mudou(setSelecionados)(marcado ? [...selecionados, id] : selecionados.filter((s) => s !== id));

  return (
    <div className="space-y-6">
      <AvisoDoQueNaoMuda />
      <Cartao>
        <CartaoCorpo>
          <form onSubmit={(e) => void verPrevia(e)} className="space-y-5" data-testid="formulario-em-massa" aria-label="Aplicação em massa">
            <EscolhaDeAlcance
              alcance={alcance}
              aoMudarAlcance={mudou(setAlcance)}
              ativos={ativos}
              selecionados={selecionados}
              aoAlternar={alternar}
            />

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">Regra geral</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium text-ink" htmlFor="massa-tipo">
                  Tipo
                  <select
                    id="massa-tipo"
                    className={CAMPO}
                    value={tipo}
                    onChange={(e) => mudou(setTipo)(e.target.value as "PERCENTAGE" | "FIXED")}
                  >
                    <option value="PERCENTAGE">Percentual do preço de cada serviço</option>
                    <option value="FIXED">Valor fixo por serviço realizado</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-ink" htmlFor="massa-valor">
                  {tipo === "PERCENTAGE" ? "Percentual (%)" : "Valor por serviço (R$)"}
                  <input
                    id="massa-valor"
                    className={CAMPO}
                    inputMode="decimal"
                    placeholder={tipo === "PERCENTAGE" ? "Ex.: 40 ou 12,5" : "Ex.: 15,00"}
                    value={valor}
                    onChange={(e) => mudou(setValor)(e.target.value)}
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold text-ink">Configurações que já existem</legend>
              {(["PRESERVE", "REPLACE"] as const).map((m) => (
                <label key={m} className={clsx(OPCAO, modo === m && "border-border-strong bg-paper-muted")}>
                  <input
                    type="radio"
                    name="modo"
                    value={m}
                    className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
                    checked={modo === m}
                    onChange={() => {
                      mudou(setModo)(m);
                      // PRESERVAR nunca remove exceções.
                      if (m === "PRESERVE") setExcecoes("KEEP");
                    }}
                  />
                  <span>
                    <span className="font-medium">{ROTULO_MODO[m].titulo}</span>
                    <span className="block text-xs text-ink-soft">{ROTULO_MODO[m].descricao}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {modo === "REPLACE" && (
              <div className="space-y-2">
                <EscolhaDasExcecoes nome="excecoes-em-massa" escolha={excecoes} aoEscolher={mudou(setExcecoes)} />
                <p className="text-xs text-ink-soft">
                  {excecoes === "KEEP" ? AVISO_SUBSTITUIR_NAO_REMOVE : "A prévia mostra quem perde quais exceções antes de aplicar."}
                </p>
              </div>
            )}

            {erro && !previa && (
              <p role="alert" className="text-sm text-danger">
                {erro}
              </p>
            )}
            <Botao type="submit" className="min-h-11 w-full sm:w-auto" variante={previa ? "secundaria" : "primaria"} disabled={ocupado} aria-busy={ocupado}>
              {previa ? "Atualizar prévia" : "Ver prévia"}
            </Botao>
          </form>
        </CartaoCorpo>
      </Cartao>

      {previa && (
        <section className="space-y-4" aria-labelledby="titulo-previa" data-testid="previa-em-massa">
          <h2 id="titulo-previa" className="text-base font-semibold text-ink">
            Prévia
          </h2>
          {aviso && (
            <p role="status" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-border bg-warning-soft p-3 text-sm text-ink" data-testid="aviso-previa-atualizada">
              <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--color-warning)]" />
              {aviso}
            </p>
          )}
          <Contadores dados={previa.dados} rotuloAlterados="Serão alterados" />
          <ListaDeProfissionais dados={previa.dados} rotulos={ROTULO_RESULTADO_PREVIA} titulo="Profissionais da prévia" aplicado={false} />
          {previa.pedido.mode === "REPLACE" && previa.dados.summary.change > 0 && (
            <ConfirmacaoDeSubstituicao
              removendo={previa.pedido.exceptions === "REMOVE"}
              confirmado={confirmado}
              aoMudar={(v) => {
                setConfirmado(v);
                setErro(null);
              }}
            />
          )}
          {previa.pedido.exceptions === "REMOVE" && (
            <RemocaoNaPrevia
              dados={previa.dados}
              confirmado={confirmadoRemocao}
              aoMudar={(v) => {
                setConfirmadoRemocao(v);
                setErro(null);
              }}
            />
          )}
          {erro && (
            <p role="alert" className="text-sm text-danger">
              {erro}
            </p>
          )}
          <Botao
            type="button"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => void aplicar()}
            disabled={
              ocupado ||
              previa.dados.summary.change === 0 ||
              (previa.pedido.mode === "REPLACE" && !confirmado) ||
              (falta(previa.dados, previa.pedido) && !confirmadoRemocao)
            }
            aria-busy={ocupado}
          >
            {rotuloDoBotaoAplicar(previa.dados.summary.change)}
          </Botao>
        </section>
      )}

      {resultado && (
        <section className="space-y-4" aria-labelledby="titulo-resultado" data-testid="resultado-em-massa">
          <h2 id="titulo-resultado" className="flex items-center gap-2 text-base font-semibold text-ink">
            <CheckCircle2 size={18} aria-hidden="true" className="text-[color:var(--color-success)]" />
            Comissão aplicada
          </h2>
          <Contadores dados={resultado} rotuloAlterados="Alterados" />
          <ListaDeProfissionais dados={resultado} rotulos={ROTULO_RESULTADO_APLICADO} titulo="Resultado da operação" aplicado />
        </section>
      )}
    </div>
  );
}
