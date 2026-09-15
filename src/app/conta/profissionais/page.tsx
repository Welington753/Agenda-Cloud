"use client";

// Gestão real de profissionais do estabelecimento ativo (Lote 6D.2). Vive
// sob `/conta`, área REAL: nenhum dado, repositório ou seed da demonstração
// é importado aqui — espelha exatamente a disciplina de conta/servicos/page.tsx.
//
// Reutiliza `useServicosReais` só para LER o catálogo de serviços do tenant
// (ativos e inativos, exatamente o que o seletor de vínculos precisa) — nunca
// duplica a busca de serviços, nunca usa as ações de gravação desse hook
// aqui.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, PlusCircle, Store, UserRound } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { useProfissionaisReais } from "@/lib/profissionais/use-profissionais-reais";
import { mensagemFalhaProfissionais } from "@/lib/profissionais/mensagens";
import { useServicosReais } from "@/lib/servicos/use-servicos-reais";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { FormularioProfissional, type DadosFormularioProfissional } from "./formulario-profissional";
import { ListaProfissionais } from "./lista-profissionais";

type Edicao =
  | { modo: "fechado" }
  | { modo: "novo" }
  | { modo: "editar"; profissional: ProfissionalReal };

export default function ProfissionaisPage() {
  const { estado: estadoSessao } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();

  const sessao = estadoSessao.status === "autenticado" ? estadoSessao.sessao : null;
  const tenantIdAtivo = estadoSessao.status === "autenticado" ? estadoSessao.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  const { estado, gravando, recarregar, criar, editar, desativar, reativar, definirServicos } =
    useProfissionaisReais(tenantIdAtivo);
  const { estado: estadoServicos } = useServicosReais(tenantIdAtivo);

  const [edicao, setEdicao] = useState<Edicao>({ modo: "fechado" });
  // Guarda a gravação de PONTA A PONTA de um "Salvar" na edição (que pode ser
  // dois envios sequenciais: nome e vínculos) — separado do `gravando` do
  // hook, que só cobre UMA chamada por vez e ficaria "false" por um instante
  // entre as duas, reabilitando o botão cedo demais.
  const [salvandoFormulario, setSalvandoFormulario] = useState(false);
  const [erroFormulario, setErroFormulario] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<ProfissionalReal | null>(null);
  const [reativandoId, setReativandoId] = useState<string | null>(null);

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  useEffect(() => {
    setEdicao({ modo: "fechado" });
    setSalvandoFormulario(false);
    setErroFormulario(null);
    setConfirmando(null);
    setReativandoId(null);
  }, [tenantIdAtivo]);

  if (!sessao || precisaSelecionar) return null;

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  if (!contexto) {
    return (
      <Pagina titulo="Profissionais">
        <Cartao>
          <CartaoCorpo className="flex items-start gap-3">
            <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
            <div>
              <p className="text-sm font-semibold text-ink">
                Sua conta ainda não está vinculada a um estabelecimento
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                Profissionais pertencem a um estabelecimento — quando sua conta tiver um vínculo ativo,
                eles aparecem aqui.
              </p>
            </div>
          </CartaoCorpo>
        </Cartao>
      </Pagina>
    );
  }

  async function aoSalvar(dados: DadosFormularioProfissional) {
    setErroFormulario(null);
    setSalvandoFormulario(true);
    try {
      if (edicao.modo === "editar") {
        const profissionalAntes = edicao.profissional;

        if (dados.name !== profissionalAntes.name) {
          const resultadoNome = await editar(profissionalAntes.id, { name: dados.name });
          if (!resultadoNome.ok) {
            setErroFormulario(mensagemFalhaProfissionais(resultadoNome.falha));
            return;
          }
        }

        const vinculadosAntes = new Set(profissionalAntes.services.map((s) => s.serviceId));
        const desejados = new Set(dados.serviceIds);
        const mudouServicos =
          vinculadosAntes.size !== desejados.size ||
          [...vinculadosAntes].some((id) => !desejados.has(id)) ||
          [...desejados].some((id) => !vinculadosAntes.has(id));

        if (mudouServicos) {
          const resultadoServicos = await definirServicos(profissionalAntes.id, {
            serviceIds: dados.serviceIds,
          });
          if (!resultadoServicos.ok) {
            setErroFormulario(mensagemFalhaProfissionais(resultadoServicos.falha));
            return;
          }
        }

        notificar("Profissional atualizado.", "sucesso");
        setEdicao({ modo: "fechado" });
        return;
      }

      const resultado = await criar(dados);
      if (!resultado.ok) {
        setErroFormulario(mensagemFalhaProfissionais(resultado.falha));
        return;
      }
      notificar("Profissional cadastrado.", "sucesso");
      setEdicao({ modo: "fechado" });
    } finally {
      setSalvandoFormulario(false);
    }
  }

  async function aoConfirmarDesativacao(profissional: ProfissionalReal) {
    const resultado = await desativar(profissional.id);
    setConfirmando(null);

    notificar(
      resultado.ok
        ? "Profissional desativado. Os serviços vinculados foram preservados."
        : mensagemFalhaProfissionais(resultado.falha),
      resultado.ok ? "sucesso" : "info",
    );
  }

  async function aoReativar(profissional: ProfissionalReal) {
    if (gravando) return;

    setReativandoId(profissional.id);
    const resultado = await reativar(profissional.id);
    setReativandoId(null);

    notificar(
      resultado.ok ? "Profissional reativado." : mensagemFalhaProfissionais(resultado.falha),
      resultado.ok ? "sucesso" : "info",
    );
  }

  const servicosDoTenant = estadoServicos.status === "carregada" ? estadoServicos.servicos : [];

  return (
    <Pagina titulo="Profissionais" subtitulo={contexto.tenantName}>
      {estado.status === "carregando" && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {estado.status === "falha" && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <p role="alert" className="text-sm text-ink">
              {mensagemFalhaProfissionais(estado.falha)}
            </p>
            {estado.falha.tipo !== "sem_permissao" && (
              <Botao type="button" onClick={recarregar}>
                Tentar novamente
              </Botao>
            )}
          </CartaoCorpo>
        </Cartao>
      )}

      {estado.status === "carregada" && (
        <>
          {edicao.modo === "fechado" && estado.profissionais.length > 0 && (
            <div className="flex justify-end">
              <Botao type="button" onClick={() => setEdicao({ modo: "novo" })}>
                <PlusCircle size={16} className="mr-1.5" />
                Novo profissional
              </Botao>
            </div>
          )}

          {edicao.modo !== "fechado" && (
            <Cartao>
              <CartaoCorpo>
                <h2 className="mb-4 text-sm font-semibold text-ink">
                  {edicao.modo === "editar" ? "Editar profissional" : "Novo profissional"}
                </h2>
                <FormularioProfissional
                  key={edicao.modo === "editar" ? edicao.profissional.id : "novo"}
                  profissional={edicao.modo === "editar" ? edicao.profissional : undefined}
                  servicos={servicosDoTenant}
                  enviando={salvandoFormulario}
                  erro={erroFormulario}
                  aoEnviar={(dados) => void aoSalvar(dados)}
                  aoCancelar={() => {
                    setEdicao({ modo: "fechado" });
                    setErroFormulario(null);
                  }}
                />
              </CartaoCorpo>
            </Cartao>
          )}

          {estado.profissionais.length === 0 && edicao.modo === "fechado" && (
            <EstadoVazio
              icone={UserRound}
              titulo="Nenhum profissional cadastrado"
              descricao="Cadastre quem atende neste estabelecimento para começar."
              acao={
                <Botao type="button" onClick={() => setEdicao({ modo: "novo" })}>
                  <PlusCircle size={16} className="mr-1.5" />
                  Cadastrar profissional
                </Botao>
              }
            />
          )}

          {estado.profissionais.length > 0 && (
            <ListaProfissionais
              profissionais={estado.profissionais}
              gravando={gravando}
              confirmando={confirmando}
              reativandoId={reativandoId}
              aoEditar={(profissional) => {
                setErroFormulario(null);
                setEdicao({ modo: "editar", profissional });
              }}
              aoPedirDesativacao={setConfirmando}
              aoCancelarDesativacao={() => setConfirmando(null)}
              aoConfirmarDesativacao={(profissional) => void aoConfirmarDesativacao(profissional)}
              aoReativar={(profissional) => void aoReativar(profissional)}
            />
          )}
        </>
      )}
    </Pagina>
  );
}

function Pagina({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
      <div>
        <Link href="/conta" className="text-xs font-medium text-accent hover:underline">
          <ArrowLeft size={12} className="mr-1 inline" />
          Voltar para a conta
        </Link>
        <h1 className="mt-2 text-xl font-bold text-ink">{titulo}</h1>
        {subtitulo && <p className="text-sm text-ink-soft">{subtitulo}</p>}
      </div>
      {children}
    </div>
  );
}
