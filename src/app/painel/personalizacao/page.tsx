"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { AlertCircle, ArrowDown, ArrowUp, ExternalLink, Lock, Monitor, Smartphone, Upload, X } from "lucide-react";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { featureHabilitada, podeReceberAgendamentoPublico } from "@/lib/access/access-control";
import { estabelecimentoRepository, profissionalRepository, servicoRepository } from "@/lib/repositories";
import { useClientData } from "@/lib/hooks/use-client-data";
import { validarArquivoLogo, validarUrlFoto } from "@/lib/estabelecimentos/validacao";
import { aplicarRascunhoNaIdentidade, construirRascunhoPersonalizacao, rascunhosIguais, type RascunhoPersonalizacao } from "@/lib/estabelecimentos/rascunho";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ModeloClassico } from "@/components/publico/modelo-classico";
import { ModeloModerno } from "@/components/publico/modelo-moderno";
import type { ModeloPaginaPublica } from "@/lib/types";

const ROTULO_SECAO: Record<string, string> = {
  servicos: "Serviços",
  equipe: "Equipe",
  apresentacao: "Apresentação",
  fotos: "Fotos",
};

export default function PainelPersonalizacaoPage() {
  return (
    <RequirePermission permissao="personalizacao.gerenciar">
      <ConteudoPersonalizacao />
    </RequirePermission>
  );
}

function ConteudoPersonalizacao() {
  const { tenantId, estabelecimento, terminologia, carregando, recarregar, podeAcessar } = useTenant();
  const { notificar } = useToast();

  const [rascunho, setRascunho] = useState<RascunhoPersonalizacao | null>(null);
  const [snapshot, setSnapshot] = useState<RascunhoPersonalizacao | null>(null);
  const [fotosTexto, setFotosTexto] = useState("");
  const [logoErro, setLogoErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [viewport, setViewport] = useState<"celular" | "computador">("computador");

  const { dados: dadosPreview } = useClientData(() => {
    if (!estabelecimento) return null;
    return {
      profissionais: profissionalRepository.listarPorTenant(tenantId).filter((p) => p.ativo && p.agendamentoOnlineAtivo),
      servicos: servicoRepository.listarPorTenant(tenantId).filter((s) => s.ativoNoAgendamentoPublico),
    };
  }, [tenantId, estabelecimento?.tenantId]);

  // Trocar de tenant (ou recarregar após salvar) sempre reconstrói o rascunho a
  // partir do que está salvo — nunca carrega o rascunho de outro estabelecimento
  // nem mantém uma edição pendente depois de um save bem-sucedido.
  useEffect(() => {
    if (!estabelecimento) return;
    const novoRascunho = construirRascunhoPersonalizacao(estabelecimento);
    setRascunho(novoRascunho);
    setSnapshot(novoRascunho);
    setFotosTexto(novoRascunho.fotos.join("\n"));
    setLogoErro(null);
  }, [estabelecimento]);

  if (carregando || !estabelecimento || !rascunho || !snapshot) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const avancadaHabilitada = featureHabilitada(estabelecimento.plano, estabelecimento.featuresDesativadas, "personalizacaoAvancada");
  const sujo = !rascunhosIguais(rascunho, snapshot);
  const slug = estabelecimento.slug;

  function atualizar<K extends keyof RascunhoPersonalizacao>(campo: K, valor: RascunhoPersonalizacao[K]) {
    setRascunho((r) => (r ? { ...r, [campo]: valor } : r));
  }

  function aoMudarFotos(texto: string) {
    setFotosTexto(texto);
    atualizar(
      "fotos",
      texto
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)
    );
  }

  function moverSecao(indice: number, direcao: -1 | 1) {
    setRascunho((r) => {
      if (!r) return r;
      const nova = [...r.ordemSecoes];
      const alvo = indice + direcao;
      if (alvo < 0 || alvo >= nova.length) return r;
      [nova[indice], nova[alvo]] = [nova[alvo], nova[indice]];
      return { ...r, ordemSecoes: nova };
    });
  }

  function aoSelecionarArquivoLogo(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!arquivo) return;
    const validacao = validarArquivoLogo({ type: arquivo.type, size: arquivo.size });
    if (!validacao.valido) {
      setLogoErro(validacao.motivo ?? "Arquivo inválido.");
      return;
    }
    setLogoErro(null);
    const leitor = new FileReader();
    leitor.onload = () => {
      if (typeof leitor.result === "string") atualizar("logoUrl", leitor.result);
    };
    leitor.readAsDataURL(arquivo);
  }

  function removerLogo() {
    atualizar("logoUrl", undefined);
    setLogoErro(null);
  }

  const cancelar = () => {
    setRascunho(snapshot);
    setFotosTexto(snapshot.fotos.join("\n"));
    setLogoErro(null);
  };

  const salvar = (abrirDepois: boolean) => {
    if (!podeAcessar("personalizacao.gerenciar").permitido) return;
    for (const foto of rascunho.fotos) {
      const validacaoFoto = validarUrlFoto(foto);
      if (!validacaoFoto.valido) {
        notificar(validacaoFoto.motivo ?? "URL de foto inválida.", "erro");
        return;
      }
    }
    setSalvando(true);
    try {
      estabelecimentoRepository.atualizar(tenantId, {
        identidadeVisual: {
          ...estabelecimento.identidadeVisual,
          modelo: rascunho.modelo,
          logoIniciais: rascunho.logoIniciais.trim().toUpperCase().slice(0, 3) || "ES",
          logoUrl: rascunho.logoUrl,
          corPrincipal: rascunho.corPrincipal,
          corSecundaria: rascunho.corSecundaria,
          corDestaque: rascunho.corDestaque,
          fotos: rascunho.fotos,
          personalizacaoAvancada: avancadaHabilitada
            ? {
                ordemSecoes: rascunho.ordemSecoes,
                rodapePersonalizado: rascunho.rodapePersonalizado.trim() || undefined,
                ocultarMarcaPlataforma: rascunho.ocultarMarca,
              }
            : estabelecimento.identidadeVisual.personalizacaoAvancada,
        },
      });
      notificar("Personalização salva.", "sucesso");
      recarregar();
      if (abrirDepois) window.open(`/${slug}`, "_blank", "noopener,noreferrer");
    } catch (erro) {
      notificar(erro instanceof Error ? erro.message : "Não foi possível salvar a personalização.", "erro");
    } finally {
      setSalvando(false);
    }
  };

  function abrirPaginaPublicaSalva() {
    window.open(`/${slug}`, "_blank", "noopener,noreferrer");
  }

  const estabelecimentoPreview = aplicarRascunhoNaIdentidade(estabelecimento, rascunho);
  const agendamentoPublicoHabilitadoPreview =
    featureHabilitada(estabelecimento.plano, estabelecimento.featuresDesativadas, "agendamentoPublico") &&
    podeReceberAgendamentoPublico(estabelecimento.status);
  const ModeloPreview = estabelecimentoPreview.identidadeVisual.modelo === "moderno" ? ModeloModerno : ModeloClassico;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-ink">Personalização</h1>
            <p className="text-sm text-ink-soft">Aparência da página pública do seu estabelecimento.</p>
          </div>
          {sujo && (
            <span className="flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-[color:var(--color-warning)]">
              <AlertCircle size={13} /> Alterações não salvas
            </span>
          )}
        </div>

        <Cartao>
          <CartaoCorpo className="space-y-4">
            <CartaoTitulo>Padrão (disponível em todos os planos)</CartaoTitulo>

            <div>
              <label className="mb-2 block text-xs font-semibold text-ink-soft">Logo</label>
              <div className="flex items-center gap-3">
                {rascunho.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={rascunho.logoUrl} alt="Prévia do logo" className="size-14 rounded-xl border border-border object-cover" />
                ) : (
                  <div
                    className="flex size-14 items-center justify-center rounded-xl text-sm font-bold text-white"
                    style={{ backgroundColor: rascunho.corDestaque }}
                  >
                    {rascunho.logoIniciais.slice(0, 3).toUpperCase() || "??"}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper-muted">
                    <Upload size={14} /> Enviar logo
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={aoSelecionarArquivoLogo}
                      className="sr-only"
                    />
                  </label>
                  {rascunho.logoUrl && (
                    <button
                      type="button"
                      onClick={removerLogo}
                      className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-ink-soft hover:underline"
                    >
                      <X size={12} /> Remover logo
                    </button>
                  )}
                </div>
              </div>
              {logoErro && <p className="mt-1.5 text-xs text-[color:var(--color-danger)]">{logoErro}</p>}
              <p className="mt-1.5 text-xs text-ink-soft">
                PNG, JPEG ou WEBP, até 500 KB. Armazenado somente neste navegador durante a demonstração — na versão
                real, o arquivo será enviado ao armazenamento seguro da plataforma. Sem logo, as iniciais abaixo são
                usadas no lugar.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Iniciais (fallback sem logo)</label>
              <input
                type="text"
                value={rascunho.logoIniciais}
                onChange={(e) => atualizar("logoIniciais", e.target.value.toUpperCase().slice(0, 3))}
                maxLength={3}
                className="w-24 rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Modelo da página pública</label>
              <div className="flex gap-2">
                {(["classico", "moderno"] as const).map((m: ModeloPaginaPublica) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={rascunho.modelo === m}
                    onClick={() => atualizar("modelo", m)}
                    className={`flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-semibold capitalize ${
                      rascunho.modelo === m ? "border-accent bg-accent text-white" : "border-border text-ink-soft"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Cor principal</label>
                <input type="color" value={rascunho.corPrincipal} onChange={(e) => atualizar("corPrincipal", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Cor secundária</label>
                <input type="color" value={rascunho.corSecundaria} onChange={(e) => atualizar("corSecundaria", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Cor de destaque</label>
                <input type="color" value={rascunho.corDestaque} onChange={(e) => atualizar("corDestaque", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Fotos (uma URL por linha)</label>
              <textarea
                value={fotosTexto}
                onChange={(e) => aoMudarFotos(e.target.value)}
                rows={3}
                placeholder="https://..."
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
              <p className="mt-1 text-xs text-ink-soft">
                Sem upload de fotos nesta demonstração — cole o link de uma imagem já hospedada (https://).
              </p>
            </div>
          </CartaoCorpo>
        </Cartao>

        <Cartao className={avancadaHabilitada ? "" : "opacity-60"}>
          <CartaoCorpo className="space-y-4">
            <div className="flex items-center justify-between">
              <CartaoTitulo>Avançada</CartaoTitulo>
              {!avancadaHabilitada && <Badge cor="aviso"><Lock size={11} className="mr-1 inline" />Plano Pro</Badge>}
            </div>
            {!avancadaHabilitada ? (
              <p className="text-sm text-ink-soft">
                Disponível no plano Pro: ordem das seções, rodapé personalizado e opção de ocultar a marca da plataforma.
              </p>
            ) : (
              <>
                <div>
                  <label className="mb-2 block text-xs font-semibold text-ink-soft">Ordem das seções da página pública</label>
                  <ul className="space-y-1.5">
                    {rascunho.ordemSecoes.map((secao, indice) => (
                      <li key={secao} className="flex items-center justify-between rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm">
                        {ROTULO_SECAO[secao]}
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => moverSecao(indice, -1)}
                            disabled={indice === 0}
                            aria-label={`Mover ${ROTULO_SECAO[secao]} para cima`}
                            className="rounded p-1 text-ink-soft hover:bg-paper-muted disabled:opacity-30"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moverSecao(indice, 1)}
                            disabled={indice === rascunho.ordemSecoes.length - 1}
                            aria-label={`Mover ${ROTULO_SECAO[secao]} para baixo`}
                            className="rounded p-1 text-ink-soft hover:bg-paper-muted disabled:opacity-30"
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink-soft">Rodapé personalizado</label>
                  <input type="text" value={rascunho.rodapePersonalizado} onChange={(e) => atualizar("rodapePersonalizado", e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink" />
                </div>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={rascunho.ocultarMarca} onChange={(e) => atualizar("ocultarMarca", e.target.checked)} />
                  Ocultar marca da plataforma na página pública
                </label>
              </>
            )}
          </CartaoCorpo>
        </Cartao>

        <div className="flex flex-wrap gap-2">
          <Botao onClick={() => salvar(false)} disabled={!sujo || salvando}>
            {salvando ? "Salvando..." : "Salvar personalização"}
          </Botao>
          <Botao variante="secundaria" onClick={() => salvar(true)} disabled={salvando}>
            Salvar e abrir página pública
          </Botao>
          <Botao variante="secundaria" onClick={cancelar} disabled={!sujo || salvando}>
            Cancelar alterações
          </Botao>
          <Botao variante="fantasma" onClick={abrirPaginaPublicaSalva}>
            <ExternalLink size={16} className="mr-1.5" /> Abrir página pública salva
          </Botao>
        </div>
      </div>

      <div className="lg:sticky lg:top-4">
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <div className="flex items-center justify-between">
              <CartaoTitulo>Pré-visualização</CartaoTitulo>
              <div className="flex gap-1 rounded-full border border-border p-0.5">
                <button
                  type="button"
                  aria-pressed={viewport === "celular"}
                  aria-label="Pré-visualizar como celular"
                  onClick={() => setViewport("celular")}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${viewport === "celular" ? "bg-accent text-white" : "text-ink-soft"}`}
                >
                  <Smartphone size={13} /> Celular
                </button>
                <button
                  type="button"
                  aria-pressed={viewport === "computador"}
                  aria-label="Pré-visualizar como computador"
                  onClick={() => setViewport("computador")}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${viewport === "computador" ? "bg-accent text-white" : "text-ink-soft"}`}
                >
                  <Monitor size={13} /> Computador
                </button>
              </div>
            </div>
            <p className="text-xs text-ink-soft">
              Representa a página pública com as alterações atuais. Links e botões estão desativados aqui — nada é
              salvo até você clicar em &ldquo;Salvar personalização&rdquo;.
            </p>
            {/* A prévia reaproveita os mesmos componentes da página pública real — nunca
                um segundo sistema paralelo. onClickCapture intercepta clique/Enter para
                impedir navegação de verdade saindo desta tela, sem alterar os componentes. */}
            <div
              onClickCapture={(e) => e.preventDefault()}
              className={`mx-auto overflow-hidden rounded-[var(--radius-card)] border border-border ${
                viewport === "celular" ? "max-w-[360px]" : "w-full"
              }`}
            >
              <div className="max-h-[70vh] overflow-y-auto">
                {dadosPreview ? (
                  <ModeloPreview
                    slug={estabelecimentoPreview.slug}
                    estabelecimento={estabelecimentoPreview}
                    profissionais={dadosPreview.profissionais}
                    servicos={dadosPreview.servicos}
                    terminologia={terminologia}
                    agendamentoPublicoHabilitado={agendamentoPublicoHabilitadoPreview}
                  />
                ) : (
                  <Skeleton className="h-64 w-full" />
                )}
              </div>
            </div>
          </CartaoCorpo>
        </Cartao>
      </div>
    </div>
  );
}
