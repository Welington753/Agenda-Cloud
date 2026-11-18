"use client";

// Peças da assinatura modular, usadas na aba "Plano e adicionais" e na
// criação do estabelecimento: o essencial (sempre incluído), os adicionais
// disponíveis (marcáveis), os em desenvolvimento e planejados (desativados,
// fora do total), o limite de usuários e o resumo do valor. Só desenham: o
// cálculo vem de src/lib/administracao/assinatura.ts e o servidor confere.
import { BarChart3, CalendarDays, Coins, MessageCircle, Megaphone, Package, Store, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge-base";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { ROTULO_DISPONIBILIDADE, type Adicional, type Escolha, type ItemEssencial } from "@/lib/administracao/assinatura";
import { reais } from "@/lib/administracao/validade";

const ICONES: Record<string, LucideIcon> = {
  INDICADORES: BarChart3,
  COMISSOES: Coins,
  WHATSAPP: MessageCircle,
  ESTOQUE: Package,
  GESTAO_FINANCEIRA: Coins,
  MARKETING: Megaphone,
};

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

const preco = (centavos: number | null, prefixo = "") =>
  centavos === null ? "Preço a definir" : `${prefixo}${reais(centavos)} / mês`;

function Icone({ code }: { code: string }) {
  const Componente = ICONES[code] ?? Package;
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
      <Componente size={20} />
    </span>
  );
}

/** Nome, descrição e preço atuais do essencial (só leitura aqui: o catálogo
 * só é editado em Planos e adicionais). */
export function EssencialIncluido({ essencial }: { essencial: Pick<ItemEssencial, "name" | "description" | "priceCents"> }) {
  return (
    <Cartao>
      <CartaoCorpo className="flex flex-wrap items-center gap-4" data-testid="essencial">
        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
          <CalendarDays size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <span className="min-w-0 break-words">{essencial.name}</span> <Badge cor="sucesso">Sempre incluído</Badge>
          </p>
          <p className="mt-1 break-words text-sm text-ink-soft">{essencial.description}</p>
        </div>
        <p className="w-full text-right text-base font-bold sm:w-auto">{preco(essencial.priceCents)}</p>
      </CartaoCorpo>
    </Cartao>
  );
}

export function EscolhaDeAdicionais({
  adicionais,
  selecionados,
  aoAlternar,
  desativado,
}: {
  adicionais: readonly Adicional[];
  selecionados: readonly string[];
  aoAlternar: (code: string) => void;
  desativado?: boolean;
}) {
  const disponiveis = adicionais.filter((a) => a.availability === "AVAILABLE");
  const futuros = adicionais.filter((a) => a.availability !== "AVAILABLE");
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="titulo-adicionais">
        <div>
          <h3 id="titulo-adicionais" className="text-lg font-bold">
            Personalize com adicionais
          </h3>
          <p className="text-sm text-ink-soft">Selecione os recursos que fazem sentido para este negócio.</p>
        </div>
        <ul className="space-y-3">
          {disponiveis.map((a) => {
            const marcado = selecionados.includes(a.code);
            return (
              <li key={a.code}>
                <label
                  className={`flex min-h-11 cursor-pointer flex-wrap items-center gap-4 rounded-[var(--radius-card)] border bg-card p-4 ${
                    marcado ? "border-accent ring-1 ring-accent" : "border-border"
                  }`}
                  data-testid={`adicional-${a.code}`}
                >
                  <input
                    type="checkbox"
                    className="size-5 shrink-0"
                    checked={marcado}
                    // Sem preço definido não entra no total: só desmarca o que já estava.
                    disabled={desativado || (a.priceCents === null && !marcado)}
                    onChange={() => aoAlternar(a.code)}
                  />
                  <Icone code={a.code} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{a.name}</span>
                    <span className="block text-sm text-ink-soft">{a.description}</span>
                  </span>
                  <span className="w-full text-right font-bold sm:w-auto">{preco(a.priceCents, "+ ")}</span>
                </label>
              </li>
            );
          })}
          {!disponiveis.length && <li className="text-sm text-ink-soft">Nenhum adicional disponível no momento.</li>}
        </ul>
      </section>
      {futuros.length > 0 && (
        <section className="space-y-3" aria-labelledby="titulo-futuros">
          <div>
            <h3 id="titulo-futuros" className="text-lg font-bold">
              Módulos planejados
            </h3>
            <p className="text-sm text-ink-soft">Só poderão ser contratados quando estiverem disponíveis.</p>
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {futuros.map((a) => (
              <li
                key={a.code}
                className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 opacity-80"
                data-testid={`futuro-${a.code}`}
              >
                <input type="checkbox" className="mt-1 size-5 shrink-0" disabled aria-label={`${a.name}: indisponível`} />
                <Icone code={a.code} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    {a.name} <Badge cor="neutro">{ROTULO_DISPONIBILIDADE[a.availability]}</Badge>
                  </span>
                  <span className="block text-sm text-ink-soft">{preco(a.priceCents, "+ ")}</span>
                  <span className="block text-xs text-ink-soft">{a.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function CampoLimite({
  valor,
  aoMudar,
  erro,
  uso,
  desativado,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  erro: string | null;
  uso?: string;
  desativado?: boolean;
}) {
  return (
    <label className="block text-sm font-medium">
      Limite de usuários da equipe
      <input
        className={CAMPO}
        inputMode="numeric"
        required
        disabled={desativado}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        aria-describedby="ajuda-limite"
        data-testid="campo-limite"
      />
      <span id="ajuda-limite" className="mt-1 block text-xs font-normal text-ink-soft">
        Contas de equipe com login (profissionais, gerentes e outros acessos). Zero: nenhuma conta de equipe. Donos e
        profissionais sem login não contam. O limite não muda a mensalidade.
        {uso ? ` Uso atual: ${uso}.` : ""}
      </span>
      {erro && (
        <span role="alert" className="mt-1 block text-xs text-[color:var(--color-danger)]">
          {erro}
        </span>
      )}
    </label>
  );
}

export function ResumoDaAssinatura({
  nome,
  nomeEssencial,
  basePriceCents,
  escolha,
  limite,
  children,
}: {
  nome: string;
  /** Nome atual do essencial no catálogo. */
  nomeEssencial: string;
  basePriceCents: number | null;
  escolha: Escolha;
  limite: string;
  children?: React.ReactNode;
}) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4" data-testid="resumo-assinatura">
        <h3 className="text-lg font-bold">Resumo da assinatura</h3>
        <p className="flex items-center gap-2 rounded-lg border border-border bg-paper-muted p-3 font-semibold">
          <Store size={18} aria-hidden="true" />
          <span className="min-w-0 break-words">{nome || "Novo estabelecimento"}</span>
        </p>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt>{nomeEssencial}</dt>
            <dd>{basePriceCents === null ? "a definir" : reais(basePriceCents)}</dd>
          </div>
          {escolha.itens.map((i) => (
            <div key={i.code} className="flex justify-between gap-3">
              <dt>{i.name}</dt>
              <dd>{reais(i.priceCents)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3">
            <dt>Limite de usuários da equipe</dt>
            <dd>{limite.trim() === "" ? "a definir" : limite}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-end justify-between gap-2 border-t border-border pt-4">
          <div>
            <p className="font-semibold">Total mensal</p>
            <p className="text-xs text-ink-soft">
              {escolha.itens.length} adicional(is) selecionado(s)
              {escolha.negociado && escolha.totalCatalogoCents !== null ? ` · catálogo ${reais(escolha.totalCatalogoCents)}` : ""}
            </p>
          </div>
          <p className="text-2xl font-bold text-accent" data-testid="total-mensal">
            {escolha.totalContratadoCents === null ? "a definir" : reais(escolha.totalContratadoCents)}
          </p>
        </div>
        <p className="text-xs text-ink-soft">
          Valores específicos deste estabelecimento. Mudanças no catálogo não reajustam este contrato.
        </p>
        {children}
      </CartaoCorpo>
    </Cartao>
  );
}

export function CampoValorNegociado({
  valor,
  motivo,
  aoMudarValor,
  aoMudarMotivo,
  invalido,
}: {
  valor: string;
  motivo: string;
  aoMudarValor: (v: string) => void;
  aoMudarMotivo: (v: string) => void;
  invalido: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <label className="block text-sm font-medium">
        Valor mensal contratado (R$)
        <input className={CAMPO} inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => aoMudarValor(e.target.value)} />
      </label>
      {invalido && <p className="text-xs text-[color:var(--color-danger)]">Valor inválido.</p>}
      <label className="block text-sm font-medium">
        Motivo do valor negociado
        <input className={CAMPO} maxLength={300} value={motivo} onChange={(e) => aoMudarMotivo(e.target.value)} />
      </label>
      <p className="text-xs text-ink-soft">Deixe o valor em branco para seguir o total do catálogo.</p>
    </div>
  );
}
