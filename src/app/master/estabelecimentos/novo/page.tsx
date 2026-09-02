"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { RequirePlatformPermission } from "@/components/layout/require-platform-permission";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { BarraDeEtapas } from "@/components/ui/step-progress";
import { Badge } from "@/components/ui/badge";
import {
  auditoriaRepository,
  conviteRepository,
  estabelecimentoRepository,
  membershipRepository,
  unidadeRepository,
  usuarioEstabelecimentoRepository,
} from "@/lib/repositories";
import { DEFINICOES_PLANO, FEATURES_AINDA_NAO_IMPLEMENTADAS, ROTULO_FEATURE, obterDefinicaoPlano } from "@/lib/planos";
import { CATEGORIAS_NEGOCIO, obterTerminologia } from "@/lib/verticals/terminologia";
import { normalizarSlug, validarFormatoSlug } from "@/lib/estabelecimentos/validacao";
import type { CategoriaNegocio, CodigoPlano, Estabelecimento, Feature, ModeloPaginaPublica } from "@/lib/types";

const ETAPAS = ["Negócio", "Plano", "Identidade", "Proprietário", "Revisão"];

interface EstadoFormulario {
  nome: string;
  nomeFantasia: string;
  categoria: CategoriaNegocio;
  documentoFiscal: string;
  telefone: string;
  email: string;
  endereco: string;
  fusoHorario: string;
  plano: CodigoPlano;
  featuresDesativadas: Feature[];
  maxProfissionais: number;
  maxUnidades: number;
  slug: string;
  nomeExibido: string;
  logoIniciais: string;
  corPrincipal: string;
  corSecundaria: string;
  corDestaque: string;
  modelo: ModeloPaginaPublica;
  textoApresentacao: string;
  instagram: string;
  donoNome: string;
  donoEmail: string;
  donoTelefone: string;
}

const ESTADO_INICIAL: EstadoFormulario = {
  nome: "",
  nomeFantasia: "",
  categoria: "barbearia",
  documentoFiscal: "",
  telefone: "",
  email: "",
  endereco: "",
  fusoHorario: "America/Sao_Paulo",
  plano: "essencial",
  featuresDesativadas: [],
  maxProfissionais: obterDefinicaoPlano("essencial").limites.maxProfissionais,
  maxUnidades: obterDefinicaoPlano("essencial").limites.maxUnidades,
  slug: "",
  nomeExibido: "",
  logoIniciais: "",
  corPrincipal: "#1C1A17",
  corSecundaria: "#FAF7F2",
  corDestaque: "#B5651D",
  modelo: "classico",
  textoApresentacao: "",
  instagram: "",
  donoNome: "",
  donoEmail: "",
  donoTelefone: "",
};

export default function NovoEstabelecimentoPage() {
  return (
    <RequirePlatformPermission permissao="estabelecimentos.gerenciar">
      <ConteudoNovoEstabelecimento />
    </RequirePlatformPermission>
  );
}

function ConteudoNovoEstabelecimento() {
  const { usuario } = useAuth();
  const { notificar } = useToast();
  const router = useRouter();
  const [etapa, setEtapa] = useState(0);
  const [form, setForm] = useState<EstadoFormulario>(ESTADO_INICIAL);
  const [slugEditadoManualmente, setSlugEditadoManualmente] = useState(false);
  const [erroSlug, setErroSlug] = useState<string | null>(null);
  const [publicando, setPublicando] = useState(false);

  function atualizar<K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function aoMudarNome(nome: string) {
    atualizar("nome", nome);
    if (!slugEditadoManualmente) {
      const sugestao = normalizarSlug(nome);
      atualizar("slug", sugestao);
      setErroSlug(null);
    }
    if (!form.nomeExibido) atualizar("nomeExibido", nome);
  }

  function aoMudarSlug(slug: string) {
    setSlugEditadoManualmente(true);
    atualizar("slug", normalizarSlug(slug));
    setErroSlug(null);
  }

  function aoMudarPlano(plano: CodigoPlano) {
    const def = obterDefinicaoPlano(plano);
    setForm((f) => ({
      ...f,
      plano,
      maxProfissionais: def.limites.maxProfissionais,
      maxUnidades: def.limites.maxUnidades,
      featuresDesativadas: f.featuresDesativadas.filter((feat) => def.features.includes(feat)),
    }));
  }

  function alternarFeature(feature: Feature) {
    setForm((f) => ({
      ...f,
      featuresDesativadas: f.featuresDesativadas.includes(feature)
        ? f.featuresDesativadas.filter((x) => x !== feature)
        : [...f.featuresDesativadas, feature],
    }));
  }

  function validarEtapa(atual: number): boolean {
    if (atual === 0) {
      if (!form.nome.trim() || !form.endereco.trim() || !form.telefone.trim()) {
        notificar("Preencha nome, endereço e telefone do negócio.", "erro");
        return false;
      }
    }
    if (atual === 2) {
      const validacaoFormato = validarFormatoSlug(form.slug);
      if (!validacaoFormato.valido) {
        setErroSlug(validacaoFormato.motivo ?? "Endereço público inválido.");
        return false;
      }
      if (!estabelecimentoRepository.slugDisponivel(form.slug)) {
        setErroSlug(`O endereço "/${form.slug}" já está em uso por outro estabelecimento.`);
        return false;
      }
    }
    if (atual === 3) {
      if (!form.donoNome.trim() || !form.donoEmail.trim()) {
        notificar("Informe nome e e-mail do proprietário.", "erro");
        return false;
      }
    }
    return true;
  }

  function avancar() {
    if (!validarEtapa(etapa)) return;
    setEtapa((e) => Math.min(ETAPAS.length - 1, e + 1));
  }

  function voltar() {
    setEtapa((e) => Math.max(0, e - 1));
  }

  function publicar() {
    if (!usuario) return;
    if (!estabelecimentoRepository.slugDisponivel(form.slug)) {
      setErroSlug(`O endereço "/${form.slug}" já está em uso por outro estabelecimento.`);
      setEtapa(2);
      return;
    }
    const validacaoFinal = validarFormatoSlug(form.slug);
    if (!validacaoFinal.valido) {
      setErroSlug(validacaoFinal.motivo ?? "Endereço público inválido.");
      setEtapa(2);
      return;
    }
    setPublicando(true);

    const tenantId = `tenant-${form.slug}-${Date.now().toString(36)}`;
    const regrasIniciais = {
      antecedenciaMinimaMinutos: 60,
      limiteDiasFuturos: 30,
      prazoCancelamentoHoras: 3,
      confirmacaoAutomatica: false,
      permitirQualquerProfissional: true,
      permitirRemarcacaoCliente: true,
      exigirTelefoneCliente: true,
      exigirEmailCliente: false,
      exibirPrecoPublico: true,
      intervaloPadraoMinutos: 0,
    };

    let estabelecimento: Estabelecimento;
    try {
      estabelecimento = estabelecimentoRepository.criar({
        tenantId,
        slug: form.slug,
        categoria: form.categoria,
        identidadeVisual: {
          nome: form.nome.trim(),
          nomeCurto: form.nomeFantasia.trim() || form.nome.trim(),
          logoIniciais: (form.logoIniciais.trim() || form.nome.slice(0, 2)).toUpperCase().slice(0, 3),
          corPrincipal: form.corPrincipal,
          corSecundaria: form.corSecundaria,
          corDestaque: form.corDestaque,
          estilo: "Definido pelo master no cadastro",
          modelo: form.modelo,
          endereco: form.endereco.trim(),
          telefone: form.telefone.trim(),
          email: form.email.trim() || undefined,
          redesSociais: form.instagram.trim() ? { instagram: form.instagram.trim() } : undefined,
          textoApresentacao: form.textoApresentacao.trim(),
          fotos: [],
        },
        documentoFiscal: form.documentoFiscal.trim() || undefined,
        fusoHorario: form.fusoHorario,
        horarioGeral: { diasFuncionamento: [1, 2, 3, 4, 5, 6], abertura: "09:00", fechamento: "19:00" },
        regras: regrasIniciais,
        plano: form.plano,
        featuresDesativadas: form.featuresDesativadas,
        limites: { maxProfissionais: form.maxProfissionais, maxUnidades: form.maxUnidades },
        status: "teste",
        criadoEm: new Date().toISOString(),
        quantidadeProfissionais: 0,
      });
    } catch (erro) {
      notificar(erro instanceof Error ? erro.message : "Não foi possível criar o estabelecimento.", "erro");
      setPublicando(false);
      setEtapa(2);
      return;
    }

    unidadeRepository.criar({ tenantId, nome: "Unidade principal", endereco: form.endereco.trim(), principal: true });

    const donoUsuario = usuarioEstabelecimentoRepository.criar({
      nome: form.donoNome.trim(),
      email: form.donoEmail.trim(),
      telefone: form.donoTelefone.trim() || undefined,
      status: "convidado",
      criadoEm: new Date().toISOString(),
    });

    membershipRepository.criar({
      usuarioId: donoUsuario.id,
      tenantId,
      papel: "dono",
      permissoesLiberadas: [],
      permissoesNegadas: [],
    });

    conviteRepository.criar({
      tipo: "estabelecimento",
      nome: form.donoNome.trim(),
      email: form.donoEmail.trim(),
      tenantId,
      papel: "dono",
      expiraEm: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    auditoriaRepository.registrar({
      acao: "tenant.criado",
      usuarioResponsavelId: usuario.id,
      usuarioResponsavelNome: usuario.nome,
      tenantId,
      resumo: `Estabelecimento ${estabelecimento.identidadeVisual.nome} criado com plano ${obterDefinicaoPlano(form.plano).nome}.`,
    });

    notificar("Estabelecimento criado! Convite do proprietário pendente.", "sucesso");
    router.push(`/master/estabelecimentos/${tenantId}`);
  }

  const terminologia = obterTerminologia(form.categoria);
  const definicaoPlano = obterDefinicaoPlano(form.plano);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/master/estabelecimentos" className="text-xs font-semibold text-accent hover:underline">
          ← Estabelecimentos
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">Novo estabelecimento</h1>
      </div>

      <BarraDeEtapas etapas={ETAPAS} etapaAtual={etapa} />

      {etapa === 0 && (
        <Cartao>
          <CartaoCorpo className="space-y-4">
            <CartaoTitulo>Dados do negócio</CartaoTitulo>
            <Campo rotulo="Nome do estabelecimento">
              <input type="text" value={form.nome} onChange={(e) => aoMudarNome(e.target.value)} className={campoClasse} />
            </Campo>
            <Campo rotulo="Nome fantasia (opcional)">
              <input type="text" value={form.nomeFantasia} onChange={(e) => atualizar("nomeFantasia", e.target.value)} className={campoClasse} />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Categoria">
                <select value={form.categoria} onChange={(e) => atualizar("categoria", e.target.value as CategoriaNegocio)} className={campoClasse}>
                  {CATEGORIAS_NEGOCIO.map((c) => (
                    <option key={c.valor} value={c.valor}>
                      {c.rotulo}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="CPF ou CNPJ (opcional)">
                <input type="text" value={form.documentoFiscal} onChange={(e) => atualizar("documentoFiscal", e.target.value)} className={campoClasse} />
              </Campo>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Telefone">
                <input type="text" value={form.telefone} onChange={(e) => atualizar("telefone", e.target.value)} className={campoClasse} />
              </Campo>
              <Campo rotulo="E-mail do negócio (opcional)">
                <input type="email" value={form.email} onChange={(e) => atualizar("email", e.target.value)} className={campoClasse} />
              </Campo>
            </div>
            <Campo rotulo="Endereço (unidade principal)">
              <input type="text" value={form.endereco} onChange={(e) => atualizar("endereco", e.target.value)} className={campoClasse} />
            </Campo>
            <Campo rotulo="Fuso horário">
              <select value={form.fusoHorario} onChange={(e) => atualizar("fusoHorario", e.target.value)} className={campoClasse}>
                <option value="America/Sao_Paulo">América/São Paulo (Brasília)</option>
                <option value="America/Manaus">América/Manaus</option>
                <option value="America/Rio_Branco">América/Rio Branco</option>
              </select>
            </Campo>
          </CartaoCorpo>
        </Cartao>
      )}

      {etapa === 1 && (
        <Cartao>
          <CartaoCorpo className="space-y-4">
            <CartaoTitulo>Plano e funcionalidades</CartaoTitulo>
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.values(DEFINICOES_PLANO).map((p) => (
                <button
                  key={p.codigo}
                  type="button"
                  onClick={() => aoMudarPlano(p.codigo)}
                  className={`rounded-[var(--radius-card)] border p-3 text-left transition-colors ${
                    form.plano === p.codigo ? "border-accent bg-accent-soft/30" : "border-border hover:border-accent"
                  }`}
                >
                  <p className="font-semibold text-ink">{p.nome}</p>
                  <p className="mt-1 text-xs text-ink-soft">{p.descricaoCurta}</p>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Máx. de profissionais">
                <input
                  type="number"
                  min={1}
                  value={form.maxProfissionais}
                  onChange={(e) => atualizar("maxProfissionais", Number(e.target.value))}
                  className={campoClasse}
                />
              </Campo>
              <Campo rotulo="Máx. de unidades">
                <input
                  type="number"
                  min={1}
                  value={form.maxUnidades}
                  onChange={(e) => atualizar("maxUnidades", Number(e.target.value))}
                  className={campoClasse}
                />
              </Campo>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-ink-soft">
                Funcionalidades do plano {definicaoPlano.nome} (desmarque para desativar por exceção)
              </p>
              <div className="space-y-1.5">
                {definicaoPlano.features.map((feature) => {
                  const indisponivel = FEATURES_AINDA_NAO_IMPLEMENTADAS.includes(feature);
                  const ativada = !form.featuresDesativadas.includes(feature);
                  return (
                    <label key={feature} className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={ativada} onChange={() => alternarFeature(feature)} />
                      {ROTULO_FEATURE[feature]}
                      {indisponivel && <Badge cor="aviso">Em breve</Badge>}
                    </label>
                  );
                })}
              </div>
            </div>
          </CartaoCorpo>
        </Cartao>
      )}

      {etapa === 2 && (
        <Cartao>
          <CartaoCorpo className="space-y-4">
            <CartaoTitulo>Identidade visual</CartaoTitulo>
            <Campo rotulo="Slug público">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-soft">/</span>
                <input type="text" value={form.slug} onChange={(e) => aoMudarSlug(e.target.value)} className={campoClasse} />
              </div>
              {erroSlug && <p className="mt-1 text-xs text-[color:var(--color-danger)]">{erroSlug}</p>}
            </Campo>
            <Campo rotulo="Nome exibido na página pública">
              <input type="text" value={form.nomeExibido} onChange={(e) => atualizar("nomeExibido", e.target.value)} className={campoClasse} />
            </Campo>
            <Campo rotulo="Iniciais do logo">
              <input type="text" maxLength={3} value={form.logoIniciais} onChange={(e) => atualizar("logoIniciais", e.target.value)} className={campoClasse} />
            </Campo>
            <div className="grid grid-cols-3 gap-3">
              <Campo rotulo="Cor principal">
                <input type="color" value={form.corPrincipal} onChange={(e) => atualizar("corPrincipal", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
              </Campo>
              <Campo rotulo="Cor secundária">
                <input type="color" value={form.corSecundaria} onChange={(e) => atualizar("corSecundaria", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
              </Campo>
              <Campo rotulo="Cor de destaque">
                <input type="color" value={form.corDestaque} onChange={(e) => atualizar("corDestaque", e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
              </Campo>
            </div>
            <Campo rotulo="Modelo da página pública">
              <div className="flex gap-2">
                {(["classico", "moderno"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => atualizar("modelo", m)}
                    className={`flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-semibold capitalize ${
                      form.modelo === m ? "border-accent bg-accent text-white" : "border-border text-ink-soft"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Campo>
            <Campo rotulo="Texto de apresentação">
              <input type="text" value={form.textoApresentacao} onChange={(e) => atualizar("textoApresentacao", e.target.value)} className={campoClasse} />
            </Campo>
            <Campo rotulo="Instagram (opcional)">
              <input type="text" placeholder="@seuinstagram" value={form.instagram} onChange={(e) => atualizar("instagram", e.target.value)} className={campoClasse} />
            </Campo>

            <div className="rounded-[var(--radius-card)] border border-dashed border-border p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Pré-visualização</p>
              <div className="overflow-hidden rounded-[var(--radius-card)]" style={{ backgroundColor: form.corDestaque }}>
                <div className="flex items-center gap-3 p-4 text-white">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-white/15 text-sm font-bold">
                    {form.logoIniciais || "??"}
                  </div>
                  <div>
                    <p className="font-bold">{form.nomeExibido || "Nome do estabelecimento"}</p>
                    <p className="text-xs text-white/80">{form.endereco || "Endereço"}</p>
                  </div>
                </div>
              </div>
            </div>
          </CartaoCorpo>
        </Cartao>
      )}

      {etapa === 3 && (
        <Cartao>
          <CartaoCorpo className="space-y-4">
            <CartaoTitulo>{terminologia.estabelecimento.artigo === "a" ? "Proprietária" : "Proprietário"} do estabelecimento</CartaoTitulo>
            <Campo rotulo="Nome">
              <input type="text" value={form.donoNome} onChange={(e) => atualizar("donoNome", e.target.value)} className={campoClasse} />
            </Campo>
            <Campo rotulo="E-mail">
              <input type="email" value={form.donoEmail} onChange={(e) => atualizar("donoEmail", e.target.value)} className={campoClasse} />
            </Campo>
            <Campo rotulo="Telefone (opcional)">
              <input type="text" value={form.donoTelefone} onChange={(e) => atualizar("donoTelefone", e.target.value)} className={campoClasse} />
            </Campo>
            <p className="text-xs text-ink-soft">
              Nenhuma senha é definida aqui. Ao publicar, um convite simulado é criado para este e-mail — a pessoa
              &ldquo;aceita&rdquo; o convite (ação de demonstração) para ativar a própria conta.
            </p>
          </CartaoCorpo>
        </Cartao>
      )}

      {etapa === 4 && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <CartaoTitulo>Revisão</CartaoTitulo>
            <LinhaResumo rotulo="Nome" valor={form.nome} />
            <LinhaResumo rotulo="Categoria" valor={CATEGORIAS_NEGOCIO.find((c) => c.valor === form.categoria)?.rotulo ?? form.categoria} />
            <LinhaResumo rotulo="Plano" valor={`${definicaoPlano.nome} — ${form.maxProfissionais} profissionais, ${form.maxUnidades} unidade(s)`} />
            <LinhaResumo
              rotulo="Funcionalidades desativadas"
              valor={form.featuresDesativadas.length === 0 ? "Nenhuma" : form.featuresDesativadas.map((f) => ROTULO_FEATURE[f]).join(", ")}
            />
            <LinhaResumo rotulo="Slug público" valor={`/${form.slug}`} />
            <LinhaResumo rotulo="Modelo de página" valor={form.modelo} />
            <LinhaResumo rotulo="Proprietário" valor={`${form.donoNome} (${form.donoEmail})`} />
            <LinhaResumo rotulo="Status inicial" valor="Em teste" />
          </CartaoCorpo>
        </Cartao>
      )}

      <div className="flex justify-between">
        {etapa > 0 ? (
          <Botao variante="secundaria" onClick={voltar}>
            <ChevronLeft size={16} className="mr-1" /> Voltar
          </Botao>
        ) : (
          <span />
        )}
        {etapa < ETAPAS.length - 1 ? (
          <Botao onClick={avancar}>
            Continuar <ChevronRight size={16} className="ml-1" />
          </Botao>
        ) : (
          <Botao onClick={publicar} disabled={publicando}>
            <Check size={16} className="mr-1.5" /> {publicando ? "Publicando..." : "Publicar estabelecimento"}
          </Botao>
        )}
      </div>
    </div>
  );
}

const campoClasse = "w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink";

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-ink-soft">{rotulo}</label>
      {children}
    </div>
  );
}

function LinhaResumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-ink-soft">{rotulo}</span>
      <span className="text-right font-medium text-ink">{valor}</span>
    </div>
  );
}
