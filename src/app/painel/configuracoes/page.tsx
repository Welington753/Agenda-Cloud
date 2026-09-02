"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, RotateCcw } from "lucide-react";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { estabelecimentoRepository } from "@/lib/repositories";
import { restaurarTenant } from "@/lib/repositories/restaurar";
import { CATEGORIAS_NEGOCIO } from "@/lib/verticals/terminologia";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CategoriaNegocio, DiaSemana } from "@/lib/types";

const DIAS: { valor: DiaSemana; rotulo: string }[] = [
  { valor: 0, rotulo: "Dom" },
  { valor: 1, rotulo: "Seg" },
  { valor: 2, rotulo: "Ter" },
  { valor: 3, rotulo: "Qua" },
  { valor: 4, rotulo: "Qui" },
  { valor: 5, rotulo: "Sex" },
  { valor: 6, rotulo: "Sáb" },
];

export default function PainelConfiguracoesPage() {
  return (
    <RequirePermission permissao="configuracoes.gerenciar">
      <ConteudoConfiguracoes />
    </RequirePermission>
  );
}

function ConteudoConfiguracoes() {
  const { tenantId, terminologia, estabelecimento: dados, carregando, recarregar, podeAcessar } = useTenant();
  const { notificar } = useToast();

  const [copiado, setCopiado] = useState(false);
  const [form, setForm] = useState({
    categoria: "outro" as CategoriaNegocio,
    nome: "",
    nomeCurto: "",
    endereco: "",
    telefone: "",
    instagram: "",
    textoApresentacao: "",
    orientacoesAntesVisita: "",
    diasFuncionamento: [] as DiaSemana[],
    abertura: "09:00",
    fechamento: "19:00",
    antecedenciaMinimaMinutos: 60,
    limiteDiasFuturos: 30,
    prazoCancelamentoHoras: 3,
    intervaloPadraoMinutos: 0,
    confirmacaoAutomatica: false,
    permitirQualquerProfissional: true,
    permitirRemarcacaoCliente: true,
    exigirTelefoneCliente: true,
    exibirPrecoPublico: true,
  });

  useEffect(() => {
    if (!dados) return;
    setForm({
      categoria: dados.categoria,
      nome: dados.identidadeVisual.nome,
      nomeCurto: dados.identidadeVisual.nomeCurto,
      endereco: dados.identidadeVisual.endereco,
      telefone: dados.identidadeVisual.telefone,
      instagram: dados.identidadeVisual.redesSociais?.instagram ?? "",
      textoApresentacao: dados.identidadeVisual.textoApresentacao,
      orientacoesAntesVisita: dados.regras.orientacoesAntesVisita ?? "",
      diasFuncionamento: dados.horarioGeral.diasFuncionamento,
      abertura: dados.horarioGeral.abertura,
      fechamento: dados.horarioGeral.fechamento,
      antecedenciaMinimaMinutos: dados.regras.antecedenciaMinimaMinutos,
      limiteDiasFuturos: dados.regras.limiteDiasFuturos,
      prazoCancelamentoHoras: dados.regras.prazoCancelamentoHoras,
      intervaloPadraoMinutos: dados.regras.intervaloPadraoMinutos,
      confirmacaoAutomatica: dados.regras.confirmacaoAutomatica,
      permitirQualquerProfissional: dados.regras.permitirQualquerProfissional,
      permitirRemarcacaoCliente: dados.regras.permitirRemarcacaoCliente,
      exigirTelefoneCliente: dados.regras.exigirTelefoneCliente,
      exibirPrecoPublico: dados.regras.exibirPrecoPublico,
    });
  }, [dados]);

  if (carregando || !dados) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const slugAtual = dados.slug;

  function alternarDia(dia: DiaSemana) {
    setForm((f) => ({
      ...f,
      diasFuncionamento: f.diasFuncionamento.includes(dia)
        ? f.diasFuncionamento.filter((d) => d !== dia)
        : [...f.diasFuncionamento, dia].sort((a, b) => a - b),
    }));
  }

  // Confere a permissão de novo aqui dentro — a página já está atrás de
  // <RequirePermission>, mas a função que muta nunca deve depender só disso
  // (mesma disciplina aplicada em /master/administradores e nas comissões).
  function salvar() {
    if (!podeAcessar("configuracoes.gerenciar").permitido) return;
    try {
      estabelecimentoRepository.atualizar(tenantId, {
        categoria: form.categoria,
        identidadeVisual: {
          ...dados!.identidadeVisual,
          nome: form.nome.trim(),
          nomeCurto: form.nomeCurto.trim() || form.nome.trim(),
          endereco: form.endereco.trim(),
          telefone: form.telefone.trim(),
          redesSociais: form.instagram.trim() ? { instagram: form.instagram.trim() } : undefined,
          textoApresentacao: form.textoApresentacao.trim(),
        },
        horarioGeral: {
          diasFuncionamento: form.diasFuncionamento,
          abertura: form.abertura,
          fechamento: form.fechamento,
        },
        regras: {
          ...dados!.regras,
          antecedenciaMinimaMinutos: form.antecedenciaMinimaMinutos,
          limiteDiasFuturos: form.limiteDiasFuturos,
          prazoCancelamentoHoras: form.prazoCancelamentoHoras,
          intervaloPadraoMinutos: form.intervaloPadraoMinutos,
          confirmacaoAutomatica: form.confirmacaoAutomatica,
          permitirQualquerProfissional: form.permitirQualquerProfissional,
          permitirRemarcacaoCliente: form.permitirRemarcacaoCliente,
          exigirTelefoneCliente: form.exigirTelefoneCliente,
          exibirPrecoPublico: form.exibirPrecoPublico,
          orientacoesAntesVisita: form.orientacoesAntesVisita.trim() || undefined,
        },
      });
      notificar("Configurações salvas.", "sucesso");
      recarregar();
    } catch (erro) {
      notificar(erro instanceof Error ? erro.message : "Não foi possível salvar as configurações.", "erro");
    }
  }

  function copiarLink() {
    const link = `${window.location.origin}/${slugAtual}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  function abrirPaginaPublica() {
    window.open(`/${slugAtual}`, "_blank", "noopener,noreferrer");
  }

  function aoRestaurar() {
    if (
      !window.confirm(
        `Isso vai apagar os dados simulados ${terminologia.estabelecimento.artigo === "a" ? "desta" : "deste"} ${terminologia.estabelecimento.singular.toLowerCase()} e recarregar a demonstração original. Outros estabelecimentos não são afetados. Continuar?`
      )
    ) {
      return;
    }
    restaurarTenant(tenantId);
    notificar("Dados restaurados para o estado inicial da demonstração.", "sucesso");
    recarregar();
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">Configurações</h1>
        <p className="text-sm text-ink-soft">
          Dados públicos e regras da agenda {terminologia.estabelecimento.artigo === "a" ? "da sua" : "do seu"}{" "}
          {terminologia.estabelecimento.singular.toLowerCase()}.
        </p>
      </div>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <CartaoTitulo>Categoria do negócio</CartaoTitulo>
          <Campo rotulo="Categoria">
            <select
              value={form.categoria}
              onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value as CategoriaNegocio }))}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            >
              {CATEGORIAS_NEGOCIO.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </Campo>
          <p className="text-xs text-ink-soft">
            Define os termos usados na interface (ex.: {terminologia.profissional.singular.toLowerCase()},{" "}
            {terminologia.consumidor.singular.toLowerCase()}, {terminologia.agendamento.singular.toLowerCase()}).
          </p>
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <CartaoTitulo>Identidade e informações públicas</CartaoTitulo>
          <Campo rotulo={`Nome ${terminologia.estabelecimento.artigo === "a" ? "da" : "do"} ${terminologia.estabelecimento.singular.toLowerCase()}`}>
            <input
              type="text"
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo rotulo="Nome curto (usado no painel)">
            <input
              type="text"
              value={form.nomeCurto}
              onChange={(e) => setForm((f) => ({ ...f, nomeCurto: e.target.value }))}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo rotulo="Endereço">
            <input
              type="text"
              value={form.endereco}
              onChange={(e) => setForm((f) => ({ ...f, endereco: e.target.value }))}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo rotulo="Texto de apresentação">
            <textarea
              value={form.textoApresentacao}
              onChange={(e) => setForm((f) => ({ ...f, textoApresentacao: e.target.value }))}
              rows={3}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Telefone/WhatsApp">
              <input
                type="text"
                value={form.telefone}
                onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </Campo>
            <Campo rotulo="Instagram">
              <input
                type="text"
                value={form.instagram}
                onChange={(e) => setForm((f) => ({ ...f, instagram: e.target.value }))}
                placeholder="@seuinstagram"
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </Campo>
          </div>
          <Campo rotulo="Orientações antes da visita (opcional)">
            <textarea
              value={form.orientacoesAntesVisita}
              onChange={(e) => setForm((f) => ({ ...f, orientacoesAntesVisita: e.target.value }))}
              rows={3}
              placeholder={"Chegue com 5 minutos de antecedência.\nEstacionamento disponível na rua lateral.\nEm caso de atraso, entre em contato pelo WhatsApp."}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
            <p className="mt-1 text-xs text-ink-soft">
              Mostrado como texto simples na página pública, nunca como HTML.
            </p>
          </Campo>
          <Campo rotulo="Link público">
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={`/${slugAtual}`}
                className="w-full rounded-[var(--radius-control)] border border-border bg-paper-muted px-3 py-2 text-sm text-ink-soft"
              />
              <Botao tamanho="sm" variante="secundaria" onClick={copiarLink} aria-label="Copiar link público">
                {copiado ? <Check size={16} /> : <Copy size={16} />}
              </Botao>
              <Botao tamanho="sm" variante="secundaria" onClick={abrirPaginaPublica}>
                <ExternalLink size={16} className="mr-1.5" /> Abrir página pública
              </Botao>
            </div>
          </Campo>
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <CartaoTitulo>Horários gerais</CartaoTitulo>
          <div className="flex flex-wrap gap-1.5">
            {DIAS.map((d) => (
              <button
                key={d.valor}
                type="button"
                onClick={() => alternarDia(d.valor)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  form.diasFuncionamento.includes(d.valor)
                    ? "border-accent bg-accent text-white"
                    : "border-border text-ink-soft"
                }`}
              >
                {d.rotulo}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Abertura">
              <input
                type="time"
                value={form.abertura}
                onChange={(e) => setForm((f) => ({ ...f, abertura: e.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </Campo>
            <Campo rotulo="Fechamento">
              <input
                type="time"
                value={form.fechamento}
                onChange={(e) => setForm((f) => ({ ...f, fechamento: e.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </Campo>
          </div>
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <CartaoTitulo>Política de agendamento</CartaoTitulo>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Campo rotulo="Antecedência mín. (min)">
              <input
                type="number"
                min={0}
                value={form.antecedenciaMinimaMinutos}
                onChange={(e) => setForm((f) => ({ ...f, antecedenciaMinimaMinutos: Number(e.target.value) }))}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </Campo>
            <Campo rotulo="Agendar até (dias)">
              <input
                type="number"
                min={1}
                value={form.limiteDiasFuturos}
                onChange={(e) => setForm((f) => ({ ...f, limiteDiasFuturos: Number(e.target.value) }))}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </Campo>
            <Campo rotulo="Cancelar até (h antes)">
              <input
                type="number"
                min={0}
                value={form.prazoCancelamentoHoras}
                onChange={(e) => setForm((f) => ({ ...f, prazoCancelamentoHoras: Number(e.target.value) }))}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </Campo>
            <Campo rotulo="Intervalo padrão (min)">
              <input
                type="number"
                min={0}
                value={form.intervaloPadraoMinutos}
                onChange={(e) => setForm((f) => ({ ...f, intervaloPadraoMinutos: Number(e.target.value) }))}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </Campo>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={form.confirmacaoAutomatica}
                onChange={(e) => setForm((f) => ({ ...f, confirmacaoAutomatica: e.target.checked }))}
              />
              {`${terminologia.agendamento.plural} públicos nascem já confirmados (sem revisão manual)`}
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={form.permitirQualquerProfissional}
                onChange={(e) => setForm((f) => ({ ...f, permitirQualquerProfissional: e.target.checked }))}
              />
              {`Permitir que o ${terminologia.consumidor.singular.toLowerCase()} escolha "qualquer ${terminologia.profissional.singular.toLowerCase()}"`}
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={form.permitirRemarcacaoCliente}
                onChange={(e) => setForm((f) => ({ ...f, permitirRemarcacaoCliente: e.target.checked }))}
              />
              {`Permitir que o ${terminologia.consumidor.singular.toLowerCase()} remarque pelo link de confirmação`}
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={form.exigirTelefoneCliente}
                onChange={(e) => setForm((f) => ({ ...f, exigirTelefoneCliente: e.target.checked }))}
              />
              {`Exigir telefone do ${terminologia.consumidor.singular.toLowerCase()} no agendamento público`}
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={form.exibirPrecoPublico}
                onChange={(e) => setForm((f) => ({ ...f, exibirPrecoPublico: e.target.checked }))}
              />
              Exibir preços na página pública (serviços individuais ainda podem ocultar o próprio preço)
            </label>
          </div>
        </CartaoCorpo>
      </Cartao>

      <Botao onClick={salvar}>Salvar configurações</Botao>

      <Cartao className="border-dashed">
        <CartaoCorpo className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-ink">Restaurar dados da demonstração</p>
            <p className="text-sm text-ink-soft">
              Restaura somente {terminologia.estabelecimento.artigo === "a" ? "esta" : "este"}{" "}
              {terminologia.estabelecimento.singular.toLowerCase()} para os dados simulados originais. Outros
              estabelecimentos não são afetados.
            </p>
          </div>
          <Botao variante="secundaria" onClick={aoRestaurar}>
            <RotateCcw size={16} className="mr-1.5" /> Restaurar
          </Botao>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-ink-soft">{rotulo}</label>
      {children}
    </div>
  );
}
