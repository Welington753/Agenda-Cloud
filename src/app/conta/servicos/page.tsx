"use client";

// Gestão real de serviços do estabelecimento ativo (Lote 6D.1, reativação no
// complemento seguinte). Vive sob `/conta`, que já é área REAL: nenhum dado,
// repositório ou seed da demonstração é importado aqui (ver o layout de
// `/conta` e a auditoria de `sem-dados-demo.test.ts`).
//
// Sem estabelecimento ativo, a tela nunca inventa um: encaminha para a seleção
// já existente quando há vários vínculos, ou mostra o estado de ausência de
// acesso quando não há nenhum.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, PlusCircle, Store, Wrench } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { useServicosReais } from "@/lib/servicos/use-servicos-reais";
import { mensagemFalhaServicos } from "@/lib/servicos/mensagens";
import type { DadosServicoReal, ServicoReal } from "@/lib/api/services-api";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { FormularioServico } from "./formulario-servico";
import { ListaServicos } from "./lista-servicos";

type Edicao = { modo: "fechado" } | { modo: "novo" } | { modo: "editar"; servico: ServicoReal };

export default function ServicosPage() {
  const { estado: estadoSessao } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();

  const sessao = estadoSessao.status === "autenticado" ? estadoSessao.sessao : null;
  const tenantIdAtivo = estadoSessao.status === "autenticado" ? estadoSessao.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  const { estado, gravando, recarregar, criar, editar, desativar, reativar } =
    useServicosReais(tenantIdAtivo);
  const [edicao, setEdicao] = useState<Edicao>({ modo: "fechado" });
  const [erroFormulario, setErroFormulario] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<ServicoReal | null>(null);
  // Só para trocar o rótulo do botão clicado ("Reativando...") — o bloqueio
  // de fato contra clique duplicado é `gravando` (compartilhado por toda
  // gravação, ver use-servicos-reais.ts), nunca este estado sozinho.
  const [reativandoId, setReativandoId] = useState<string | null>(null);

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  // Trocar de estabelecimento fecha qualquer formulário/confirmação aberta —
  // continuar editando ou reativando um serviço do tenant anterior não faria
  // sentido.
  useEffect(() => {
    setEdicao({ modo: "fechado" });
    setErroFormulario(null);
    setConfirmando(null);
    setReativandoId(null);
  }, [tenantIdAtivo]);

  if (!sessao || precisaSelecionar) return null;

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  if (!contexto) {
    return (
      <Pagina titulo="Serviços">
        <Cartao>
          <CartaoCorpo className="flex items-start gap-3">
            <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
            <div>
              <p className="text-sm font-semibold text-ink">
                Sua conta ainda não está vinculada a um estabelecimento
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                Serviços pertencem a um estabelecimento — quando sua conta tiver um vínculo ativo,
                eles aparecem aqui.
              </p>
            </div>
          </CartaoCorpo>
        </Cartao>
      </Pagina>
    );
  }

  async function aoSalvar(dados: DadosServicoReal) {
    setErroFormulario(null);
    const resultado =
      edicao.modo === "editar"
        ? await editar(edicao.servico.id, dados)
        : await criar(dados);

    if (!resultado.ok) {
      // Nunca reenvia sozinho: a mensagem fica, o formulário continua
      // preenchido e a pessoa decide se tenta de novo.
      setErroFormulario(mensagemFalhaServicos(resultado.falha));
      return;
    }

    notificar(
      edicao.modo === "editar" ? "Serviço atualizado." : "Serviço cadastrado.",
      "sucesso",
    );
    setEdicao({ modo: "fechado" });
  }

  async function aoConfirmarDesativacao(servico: ServicoReal) {
    const resultado = await desativar(servico.id);
    setConfirmando(null);

    notificar(
      resultado.ok
        ? "Serviço desativado. O histórico foi preservado."
        : mensagemFalhaServicos(resultado.falha),
      resultado.ok ? "sucesso" : "info",
    );
  }

  async function aoReativar(servico: ServicoReal) {
    // Segunda barreira contra envio duplicado, além do `disabled` do botão:
    // um clique já despachado antes do re-render nunca dispara uma segunda
    // chamada.
    if (gravando) return;

    setReativandoId(servico.id);
    const resultado = await reativar(servico.id);
    setReativandoId(null);

    notificar(
      resultado.ok ? "Serviço reativado." : mensagemFalhaServicos(resultado.falha),
      resultado.ok ? "sucesso" : "info",
    );
  }

  return (
    <Pagina titulo="Serviços" subtitulo={contexto.tenantName}>
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
              {mensagemFalhaServicos(estado.falha)}
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
          {edicao.modo === "fechado" && estado.servicos.length > 0 && (
            <div className="flex justify-end">
              <Botao type="button" onClick={() => setEdicao({ modo: "novo" })}>
                <PlusCircle size={16} className="mr-1.5" />
                Novo serviço
              </Botao>
            </div>
          )}

          {edicao.modo !== "fechado" && (
            <Cartao>
              <CartaoCorpo>
                <h2 className="mb-4 text-sm font-semibold text-ink">
                  {edicao.modo === "editar" ? "Editar serviço" : "Novo serviço"}
                </h2>
                <FormularioServico
                  key={edicao.modo === "editar" ? edicao.servico.id : "novo"}
                  servico={edicao.modo === "editar" ? edicao.servico : undefined}
                  enviando={gravando}
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

          {estado.servicos.length === 0 && edicao.modo === "fechado" && (
            <EstadoVazio
              icone={Wrench}
              titulo="Nenhum serviço cadastrado"
              descricao="Cadastre o que este estabelecimento oferece para começar."
              acao={
                <Botao type="button" onClick={() => setEdicao({ modo: "novo" })}>
                  <PlusCircle size={16} className="mr-1.5" />
                  Cadastrar serviço
                </Botao>
              }
            />
          )}

          {estado.servicos.length > 0 && (
            <ListaServicos
              servicos={estado.servicos}
              gravando={gravando}
              confirmando={confirmando}
              reativandoId={reativandoId}
              aoEditar={(servico) => {
                setErroFormulario(null);
                setEdicao({ modo: "editar", servico });
              }}
              aoPedirDesativacao={setConfirmando}
              aoCancelarDesativacao={() => setConfirmando(null)}
              aoConfirmarDesativacao={(servico) => void aoConfirmarDesativacao(servico)}
              aoReativar={(servico) => void aoReativar(servico)}
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
