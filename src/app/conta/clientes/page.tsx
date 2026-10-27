"use client";

// Clientes do estabelecimento ativo: a primeira página aparece ao abrir
// (GET /tenants/:tenantId/consumers/page, paginada e ordenada no servidor), a
// busca filtra essa mesma listagem e o cadastro usa POST .../consumers. Sem
// edição, exclusão nem histórico. O funcionário não chega aqui (o shell o
// leva à agenda dele) e o servidor recusa a rota a ele de qualquer forma.
//
// Vive sob `/conta`, área REAL: nada da demonstração é importado (ver
// lib/servicos/sem-dados-demo.test.ts). O cliente cadastrado aqui é o mesmo
// que o seletor de "Novo agendamento" encontra na Agenda — o formulário de
// agendamento não é duplicado.
//
// Cadastro, os três desfechos que importam:
//  - CONFIRMADO: o aviso de sucesso fica na tela e a busca pelo WhatsApp roda
//    em seguida (a lista filtrada mostra o cliente novo). Se só essa leitura falhar, o aviso continua e "Tentar
//    novamente" repete só a leitura, nunca o POST.
//  - DUPLICADO (409): nada é sobrescrito; o formulário continua preenchido e
//    oferece pesquisar o WhatsApp.
//  - INCERTO (sem resposta): o cliente pode ter sido gravado. A tela diz isso
//    e oferece pesquisar antes de qualquer nova tentativa. Nunca reenvia.
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Search, Store, UserPlus, X } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { TERMO_MINIMO_BUSCA, type ClienteReal, type DadosCadastroCliente } from "@/lib/api/consumers-api";
import { mensagemFalhaCadastro } from "@/lib/clientes/cadastro";
import { useClientesReais } from "@/lib/clientes/use-clientes-reais";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { FormularioCliente } from "./formulario-cliente";
import { ListaClientes } from "./lista-clientes";
import { ROTA_AGENDA } from "@/lib/conta/rotas";

/** Falha do cadastro com o WhatsApp tentado, para oferecer a pesquisa. */
interface ErroCadastro {
  mensagem: string;
  whatsapp: string | null;
}

export default function ClientesPage() {
  const { estado: estadoSessao } = useRealAuth();
  const router = useRouter();

  const sessao = estadoSessao.status === "autenticado" ? estadoSessao.sessao : null;
  const tenantIdAtivo = estadoSessao.status === "autenticado" ? estadoSessao.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  const { lista, gravando, listar, carregarMais, repetir, cadastrar } = useClientesReais(tenantIdAtivo);
  const [termo, setTermo] = useState("");
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [erroCadastro, setErroCadastro] = useState<ErroCadastro | null>(null);
  const [cadastrado, setCadastrado] = useState<ClienteReal | null>(null);

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  // Trocar de estabelecimento descarta tudo o que pertencia ao anterior.
  useEffect(() => {
    setTermo("");
    setFormularioAberto(false);
    setErroCadastro(null);
    setCadastrado(null);
  }, [tenantIdAtivo]);

  if (!sessao || precisaSelecionar) return null;

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  if (!contexto) {
    return (
      <PaginaConta titulo="Clientes">
        <Cartao>
          <CartaoCorpo className="flex items-start gap-3">
            <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
            <div>
              <p className="text-sm font-semibold text-ink">
                Sua conta ainda não está vinculada a um estabelecimento
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                Clientes pertencem a um estabelecimento — quando sua conta tiver um vínculo ativo,
                você poderá consultá-los aqui.
              </p>
            </div>
          </CartaoCorpo>
        </Cartao>
      </PaginaConta>
    );
  }

  function aoPesquisar(evento: FormEvent) {
    evento.preventDefault();
    listar(termo);
  }

  function pesquisarWhatsapp(whatsapp: string) {
    setTermo(whatsapp);
    listar(whatsapp);
  }

  function limparBusca() {
    setTermo("");
    listar(null);
  }

  function abrirFormulario() {
    setErroCadastro(null);
    setFormularioAberto(true);
  }

  async function aoCadastrar(dados: DadosCadastroCliente) {
    setErroCadastro(null);
    const resultado = await cadastrar(dados);
    if (!resultado) return;

    if (!resultado.ok) {
      const comPesquisa =
        resultado.falha.tipo === "duplicado" || resultado.falha.tipo === "falha_comunicacao";
      setErroCadastro({
        mensagem: mensagemFalhaCadastro(resultado.falha),
        whatsapp: comPesquisa ? dados.whatsapp : null,
      });
      return;
    }

    setCadastrado(resultado.dados);
    setFormularioAberto(false);
    pesquisarWhatsapp(resultado.dados.whatsapp);
  }

  const buscaBloqueada = lista.status === "falha" && lista.falha.tipo === "sem_permissao";
  const termoDigitado = termo.trim();
  // Um caractere ainda não filtra (mesma regra do servidor); vazio volta a
  // mostrar todos.
  const termoIncompleto = termoDigitado.length > 0 && termoDigitado.length < TERMO_MINIMO_BUSCA;

  return (
    <PaginaConta
      titulo="Clientes"
      descricao="Todos os clientes do estabelecimento, em ordem alfabética. Filtre pelo nome ou WhatsApp."
      acoes={
        !formularioAberto ? (
          <Botao type="button" onClick={abrirFormulario}>
            <UserPlus size={16} aria-hidden="true" />
            Novo cliente
          </Botao>
        ) : undefined
      }
    >
      {cadastrado && (
        <div
          role="status"
          data-testid="cliente-cadastrado"
          className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4"
        >
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-ink">Cliente {cadastrado.name} cadastrado.</p>
            <p className="mt-1 text-ink-soft">
              Para agendar, abra a{" "}
              <Link href={ROTA_AGENDA} className="font-medium text-[color:var(--color-accent-hover)] underline">
                Agenda
              </Link>{" "}
              e use “Buscar cliente” em Novo agendamento.
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => setCadastrado(null)}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-ink-soft hover:bg-paper-muted"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {formularioAberto && (
        <Cartao>
          <CartaoCorpo>
            <h2 className="mb-4 text-sm font-semibold text-ink">Novo cliente</h2>
            <FormularioCliente
              key={tenantIdAtivo}
              enviando={gravando}
              erro={erroCadastro?.mensagem ?? null}
              acaoDoErro={
                erroCadastro?.whatsapp ? (
                  <Botao
                    type="button"
                    variante="secundaria"
                    tamanho="sm"
                    disabled={gravando}
                    onClick={() => pesquisarWhatsapp(erroCadastro.whatsapp!)}
                  >
                    <Search size={14} aria-hidden="true" />
                    Pesquisar este WhatsApp
                  </Botao>
                ) : undefined
              }
              aoEnviar={(dados) => void aoCadastrar(dados)}
              aoCancelar={() => {
                setFormularioAberto(false);
                setErroCadastro(null);
              }}
            />
          </CartaoCorpo>
        </Cartao>
      )}

      <Cartao>
        <CartaoCorpo>
          <form role="search" onSubmit={aoPesquisar} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="busca-clientes" className="mb-1 block text-sm font-medium text-ink">
                Buscar cliente
              </label>
              <input
                id="busca-clientes"
                type="search"
                value={termo}
                disabled={buscaBloqueada}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Nome ou WhatsApp"
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent"
              />
            </div>
            <div className="flex gap-2">
              <Botao type="submit" disabled={buscaBloqueada || termoIncompleto} aria-busy={lista.status === "carregando"}>
                <Search size={16} aria-hidden="true" />
                Buscar
              </Botao>
              {lista.status !== "carregando" && lista.termo && (
                <Botao type="button" variante="secundaria" onClick={limparBusca} data-testid="clientes-limpar-busca">
                  Limpar
                </Botao>
              )}
            </div>
          </form>
        </CartaoCorpo>
      </Cartao>

      <ListaClientes
        lista={lista}
        destacadoId={cadastrado?.id ?? null}
        aoRepetir={repetir}
        aoCarregarMais={carregarMais}
        aoLimparBusca={limparBusca}
        aoCadastrar={formularioAberto ? null : abrirFormulario}
      />
    </PaginaConta>
  );
}
