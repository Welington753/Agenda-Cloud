"use client";

// Regras de comissão de um profissional, serviço a serviço (dono). Quatro
// escolhas: "Não configurada" (sem regra), "Sem comissão" (zero escolhido),
// percentual sobre o preço do serviço na reserva, ou valor fixo. Mudar uma
// regra vale só para as próximas conclusões: o que já foi apurado guarda a
// própria fotografia. O servidor confere tudo de novo (recurso do plano,
// permissão e se o profissional atende o serviço).
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import {
  caminhoRegra,
  caminhoRegras,
  ehRegrasDoProfissional,
  percentualParaPontosBase,
  pontosBaseParaCampo,
  rotuloDaRegra,
  type RegrasDoProfissional,
  type ServicoComRegra,
} from "@/lib/api/comissoes-api";
import { centavosParaCampo, formatarPrecoServico, precoParaCentavos } from "@/lib/servicos/dinheiro";
import { ROTA_COMISSOES, ROTA_PROFISSIONAIS } from "@/lib/conta/rotas";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoDeApuracao } from "@/components/conta/relatorio-comissoes";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

const MENSAGEM_DE_LEITURA = {
  sessao: "Sua sessão precisa ser verificada novamente. Entre de novo.",
  permissao: "Sua conta não pode configurar comissões neste estabelecimento, ou o plano não inclui comissões.",
  ausente: "Profissional não encontrado.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar as comissões.",
} as const;

const CAMPO = "mt-1 block min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm text-ink";
type Escolha = "NAO_CONFIGURADA" | "NONE" | "PERCENTAGE" | "FIXED";

export default function ComissoesDoProfissionalPage() {
  const { estado: sessao } = useRealAuth();
  const { professionalId } = useParams<{ professionalId: string }>();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const { estado, recarregar } = useLeituraPlataforma(
    tenantId ? caminhoRegras(tenantId, professionalId) : null,
    ehRegrasDoProfissional,
  );
  // A resposta de cada gravação já traz a lista atualizada; uma leitura nova
  // do servidor substitui o que foi gravado sobre a anterior.
  const [salvo, setSalvo] = useState<{ sobre: RegrasDoProfissional; dados: RegrasDoProfissional } | null>(null);
  const lido = estado.status === "pronto" ? estado.dados : null;
  const atual = lido && salvo?.sobre === lido ? salvo.dados : lido;
  if (sessao.status !== "autenticado" || !tenantId) return null;

  return (
    <PaginaConta
      titulo={atual ? `Comissões de ${atual.professional.name}` : "Comissões"}
      descricao="Defina, para cada serviço que o profissional atende, como a comissão é calculada."
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
          {atual.services.length === 0 ? (
            <p className="text-sm text-ink-soft">Este profissional ainda não atende nenhum serviço.</p>
          ) : (
            <ul className="space-y-3" data-testid="regras-de-comissao">
              {atual.services.map((s) => (
                <li key={s.service.id}>
                  <EditorDaRegra
                    tenantId={tenantId}
                    professionalId={professionalId}
                    item={s}
                    aoSalvar={(dados) => lido && setSalvo({ sobre: lido, dados })}
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
  aoSalvar,
}: {
  tenantId: string;
  professionalId: string;
  item: ServicoComRegra;
  aoSalvar: (regras: RegrasDoProfissional) => void;
}) {
  const { notificar } = useToast();
  const inicial: Escolha = item.rule === null ? "NAO_CONFIGURADA" : item.rule.kind;
  const [escolha, setEscolha] = useState<Escolha>(inicial);
  const [valor, setValor] = useState(
    item.rule?.kind === "PERCENTAGE"
      ? pontosBaseParaCampo(item.rule.value ?? 0)
      : item.rule?.kind === "FIXED"
        ? centavosParaCampo(item.rule.value)
        : "",
  );
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const idBase = `regra-${item.service.id}`;

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (gravando) return;
    let corpo: { kind: string; value?: number } | null = null;
    if (escolha === "PERCENTAGE") {
      const lido = percentualParaPontosBase(valor);
      if (!lido.ok) return setErro(lido.erro);
      corpo = { kind: "PERCENTAGE", value: lido.pontos };
    } else if (escolha === "FIXED") {
      const lido = precoParaCentavos(valor);
      if (!lido.ok) return setErro(lido.erro);
      if (lido.centavos === null || lido.centavos <= 0) return setErro("Para não pagar comissão, escolha “Sem comissão”.");
      if (lido.centavos > 100_000_000) return setErro("Valor acima do máximo aceito.");
      corpo = { kind: "FIXED", value: lido.centavos };
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
            <Badge cor={item.rule === null ? "aviso" : "neutro"} data-testid="regra-atual">
              {rotuloDaRegra(item.rule)}
            </Badge>
          </div>
          {!item.linked && (
            <p className="text-xs text-ink-soft">O profissional não atende mais este serviço; a regra só vale se ele voltar a atender.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink" htmlFor={`${idBase}-tipo`}>
              Comissão
              <select
                id={`${idBase}-tipo`}
                className={CAMPO}
                value={escolha}
                onChange={(e) => {
                  setEscolha(e.target.value as Escolha);
                  setErro(null);
                }}
              >
                <option value="NAO_CONFIGURADA">Não configurada</option>
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
                  onChange={(e) => setValor(e.target.value)}
                />
              </label>
            )}
          </div>
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
