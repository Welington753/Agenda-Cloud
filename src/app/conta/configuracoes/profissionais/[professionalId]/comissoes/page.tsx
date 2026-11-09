"use client";

// Comissão de um profissional (dono): "Recebe comissão", regra geral e
// exceções por serviço. Precedência, a mesma da apuração (calculada no
// servidor, campo `effective`): exceção do serviço (inclusive "Sem
// comissão") > regra geral > não configurada (conferência). Desligado,
// tudo fica guardado, mas nenhuma conclusão gera comissão. Mudar algo vale só
// para as próximas conclusões: o que já foi apurado guarda a própria
// fotografia. O servidor confere tudo de novo (recurso do plano, permissão e
// se o profissional atende o serviço).
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, CircleSlash } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import {
  caminhoRegra,
  caminhoRegras,
  ehRegrasDoProfissional,
  lerValor,
  rotuloDaEfetiva,
  type RegrasDoProfissional,
  type ServicoComRegra,
} from "@/lib/api/comissoes-api";
import { formatarPrecoServico } from "@/lib/servicos/dinheiro";
import { editar, estadoDoEditor, type EscolhaDaExcecao, type RascunhoDaExcecao } from "@/lib/profissionais/rascunho-da-excecao";
import { ROTA_COMISSOES, ROTA_PROFISSIONAIS } from "@/lib/conta/rotas";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoDeApuracao } from "@/components/conta/relatorio-comissoes";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { CAMPO, CartaoRecebeComissao } from "./cartao-recebe-comissao";

const MENSAGEM_DE_LEITURA = {
  sessao: "Sua sessão precisa ser verificada novamente. Entre de novo.",
  permissao: "Sua conta não pode configurar comissões neste estabelecimento, ou o plano não inclui comissões.",
  ausente: "Profissional não encontrado.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar as comissões.",
} as const;

export default function ComissoesDoProfissionalPage() {
  const { estado: sessao } = useRealAuth();
  const { professionalId } = useParams<{ professionalId: string }>();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const { estado, recarregar, anterior } = useLeituraPlataforma(
    tenantId ? caminhoRegras(tenantId, professionalId) : null,
    ehRegrasDoProfissional,
  );
  // A resposta de cada gravação já traz a lista atualizada; uma leitura nova
  // do servidor substitui o que foi gravado sobre a anterior.
  const [salvo, setSalvo] = useState<{ sobre: RegrasDoProfissional; dados: RegrasDoProfissional } | null>(null);
  // Durante uma releitura (exceções mudaram por fora), a leitura anterior
  // mantém a tela montada: o aviso e os campos do cartão não somem.
  const lido = estado.status === "pronto" ? estado.dados : anterior;
  const atual = lido && salvo?.sobre === lido ? salvo.dados : lido;
  if (sessao.status !== "autenticado" || !tenantId) return null;
  const aoSalvar = (dados: RegrasDoProfissional) => lido && setSalvo({ sobre: lido, dados });

  return (
    <PaginaConta
      titulo={atual ? `Comissões de ${atual.professional.name}` : "Comissões"}
      descricao="Defina se o profissional recebe comissão, a regra geral e as exceções por serviço."
      voltar={{ href: ROTA_PROFISSIONAIS, rotulo: "Voltar a Profissionais" }}
    >
      <AvisoDeApuracao />
      {!atual && estado.status === "carregando" && <Skeleton className="h-40 w-full" />}
      {!atual && estado.status === "erro" && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <p role="alert" className="text-sm text-ink">
              {MENSAGEM_DE_LEITURA[estado.motivo]}
            </p>
            <Botao type="button" onClick={recarregar}>
              Tentar novamente
            </Botao>
          </CartaoCorpo>
        </Cartao>
      )}
      {atual && (
        <>
          <CartaoRecebeComissao tenantId={tenantId} dados={atual} aoSalvar={aoSalvar} aoRecarregar={recarregar} />
          <h2 className="text-base font-semibold text-ink">Exceções por serviço</h2>
          {!atual.settings.receivesCommission && (
            <p
              className="flex items-start gap-2 rounded-[var(--radius-control)] border border-border bg-paper-muted p-3 text-sm text-ink"
              data-testid="aviso-nao-recebe"
            >
              <CircleSlash size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              “Recebe comissão” está desligado: as regras abaixo ficam guardadas, mas não geram comissão.
            </p>
          )}
          {atual.services.length === 0 ? (
            <p className="text-sm text-ink-soft">Este profissional ainda não atende nenhum serviço.</p>
          ) : (
            <ul className="space-y-3" data-testid="regras-de-comissao">
              {atual.services.map((s) => (
                // Sem alteração pendente, o editor mostra o valor gravado
                // (inclusive depois de remover exceções); um rascunho não salvo
                // sobrevive à releitura, com aviso (rascunho-da-excecao.ts).
                <li key={s.service.id}>
                  <EditorDaRegra
                    tenantId={tenantId}
                    professionalId={professionalId}
                    item={s}
                    temRegraGeral={atual.settings.defaultRule !== null}
                    aoSalvar={aoSalvar}
                  />
                </li>
              ))}
            </ul>
          )}
          <Link href={ROTA_COMISSOES} className="inline-flex min-h-11 items-center text-sm font-semibold text-[color:var(--color-accent-hover)] underline">
            Ver comissões apuradas
          </Link>
        </>
      )}
    </PaginaConta>
  );
}

function EditorDaRegra({
  tenantId,
  professionalId,
  item,
  temRegraGeral,
  aoSalvar,
}: {
  tenantId: string;
  professionalId: string;
  item: ServicoComRegra;
  temRegraGeral: boolean;
  aoSalvar: (regras: RegrasDoProfissional) => void;
}) {
  const { notificar } = useToast();
  const [rascunho, setRascunho] = useState<RascunhoDaExcecao | null>(null);
  const {
    campos: { escolha, valor },
    mudouPorFora,
  } = estadoDoEditor(item.rule, rascunho);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const idBase = `regra-${item.service.id}`;
  const naoConfigurada = item.effective.source === null;

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (gravando) return;
    let corpo: { kind: string; value?: number } | null = null;
    if (escolha === "PERCENTAGE" || escolha === "FIXED") {
      const lido = lerValor(escolha, valor, "Para não pagar comissão neste serviço, escolha “Sem comissão”.");
      if (!lido.ok) return setErro(lido.erro);
      corpo = lido.corpo;
    } else if (escolha === "NONE") {
      corpo = { kind: "NONE" };
    }
    setErro(null);
    setGravando(true);
    const caminho = caminhoRegra(tenantId, professionalId, item.service.id);
    const r = corpo ? await acaoAdministrativa<unknown>(caminho, "PUT", corpo) : await acaoAdministrativa<unknown>(caminho, "DELETE");
    setGravando(false);
    if (r.tipo !== "ok") return setErro(mensagemDoResultado(r));
    if (!ehRegrasDoProfissional(r.dados)) return setErro("O servidor respondeu num formato inesperado. Atualize a página.");
    notificar(`Comissão de ${item.service.name} salva.`, "sucesso");
    setRascunho(null);
    aoSalvar(r.dados);
  }

  return (
    <Cartao>
      <CartaoCorpo>
        <form onSubmit={(e) => void salvar(e)} className="space-y-3" aria-labelledby={`${idBase}-nome`} data-testid="regra-de-comissao">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p id={`${idBase}-nome`} className="font-semibold break-words text-ink">
                {item.service.name}
              </p>
              <p className="text-xs text-ink-soft">
                Preço atual: {formatarPrecoServico(item.service.priceCents)}
                {!item.service.active && " · serviço inativo"}
              </p>
            </div>
            <Badge cor={naoConfigurada ? "aviso" : "neutro"} data-testid="regra-atual">
              {naoConfigurada && <AlertTriangle size={14} aria-hidden="true" className="mr-1 inline" />}
              {rotuloDaEfetiva(item.effective)}
            </Badge>
          </div>
          {mudouPorFora && (
            <div
              className="space-y-2 rounded-[var(--radius-control)] border border-border bg-warning-soft p-3 text-sm text-ink"
              role="status"
              data-testid="aviso-regra-mudou"
            >
              <p>A comissão deste serviço mudou enquanto você editava. Sua alteração ainda não foi salva.</p>
              <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => setRascunho(null)}>
                Descartar minha alteração
              </Botao>
            </div>
          )}
          {!item.linked && (
            <p className="text-xs text-ink-soft">O profissional não atende mais este serviço; a regra só vale se ele voltar a atender.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink" htmlFor={`${idBase}-tipo`}>
              Comissão neste serviço
              <select
                id={`${idBase}-tipo`}
                className={CAMPO}
                value={escolha}
                onChange={(e) => {
                  setRascunho(editar(item.rule, rascunho, { escolha: e.target.value as EscolhaDaExcecao, valor }));
                  setErro(null);
                }}
              >
                <option value="USAR_GERAL">Usar regra geral</option>
                <option value="NONE">Sem comissão</option>
                <option value="PERCENTAGE">Percentual do preço</option>
                <option value="FIXED">Valor fixo</option>
              </select>
            </label>
            {(escolha === "PERCENTAGE" || escolha === "FIXED") && (
              <label className="text-sm font-medium text-ink" htmlFor={`${idBase}-valor`}>
                {escolha === "PERCENTAGE" ? "Percentual (%)" : "Valor (R$)"}
                <input
                  id={`${idBase}-valor`}
                  className={CAMPO}
                  inputMode="decimal"
                  placeholder={escolha === "PERCENTAGE" ? "Ex.: 40 ou 12,5" : "Ex.: 15,00"}
                  value={valor}
                  onChange={(e) => setRascunho(editar(item.rule, rascunho, { escolha, valor: e.target.value }))}
                />
              </label>
            )}
          </div>
          {escolha === "USAR_GERAL" && !temRegraGeral && (
            <p className="text-xs text-ink-soft">Sem regra geral: este serviço fica não configurado e vai para conferência.</p>
          )}
          {escolha === "PERCENTAGE" && item.service.priceCents === null && (
            <p className="text-xs text-ink-soft">Serviço sob consulta: sem preço na reserva, o percentual não tem valor e o atendimento fica para conferência.</p>
          )}
          {erro && (
            <p role="alert" className="text-sm text-danger">
              {erro}
            </p>
          )}
          <Botao type="submit" className="min-h-11" disabled={gravando} aria-busy={gravando}>
            Salvar
          </Botao>
        </form>
      </CartaoCorpo>
    </Cartao>
  );
}
