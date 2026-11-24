"use client";

// "Esqueci minha senha", aberto pelo login da equipe (`/login`) e pela
// entrada do portal (`/portal`, com `?origem=portal`). A pessoa informa o
// e-mail ou login; o servidor responde sempre igual (202) e, só se a conta
// tiver e-mail CONFIRMADO, manda um link de 1 hora para esse e-mail. Por isso
// a tela nunca diz se a conta existe: depois do envio, o texto é o mesmo
// para todo mundo. A orientação para quem entra com login sem e-mail fica
// sempre visível.
//
// Mesma coluna única do login, nos quatro temas (só tokens). Enquanto a
// primeira leitura acorda a API, o envio espera, como no login.
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck, Send, UsersRound } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { avisoDaConexao } from "@/lib/auth/conexao";
import { pedirRecuperacaoDeSenha } from "@/lib/api/recuperacao-senha-api";
import {
  CONFIRMACAO_DO_PEDIDO,
  ORIENTACAO_LOGIN_SEM_EMAIL,
  entradaDaOrigem,
  erroDoIdentificador,
  erroDoPedido,
  origemDaRecuperacao,
} from "@/lib/auth/recuperacao-senha";
import { AvisoPreparandoAcesso } from "@/components/auth/aviso-preparando-acesso";
import { FaixaConexao } from "@/components/conexao/aviso-conexao";
import { MarcaTimVix } from "@/components/marca/marca";
import { Botao, LinkBotao } from "@/components/ui/button";
import { Cartao } from "@/components/ui/card";

// Mesmo campo do login: 16 px (sem zoom no iPhone) e 48 px de altura.
const CAMPO =
  "min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3.5 py-3 text-base text-ink focus:border-accent";

export default function EsqueciSenhaPage() {
  return (
    <Suspense fallback={null}>
      <EsqueciSenhaConteudo />
    </Suspense>
  );
}

function EsqueciSenhaConteudo() {
  const searchParams = useSearchParams();
  const entrada = entradaDaOrigem(origemDaRecuperacao(searchParams.get("origem")));
  const { estado, conexao, recarregar } = useRealAuth();
  const aguardandoServidor = conexao === "acordando" || conexao === "sem_internet";
  const conexaoExibida = avisoDaConexao(estado, conexao);

  const [identificador, setIdentificador] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando || aguardandoServidor) return;
    const problema = erroDoIdentificador(identificador);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setEnviando(true);
    const resultado = await pedirRecuperacaoDeSenha(identificador);
    setEnviando(false);
    if (resultado === "aceito") {
      setEnviado(true);
      setIdentificador("");
    } else setErro(erroDoPedido(resultado));
  }

  return (
    <div className="flex min-h-dvh flex-col px-4 py-6 sm:px-6 sm:py-10">
      <main className="mx-auto my-auto w-full max-w-md">
        <div className="mb-5 flex flex-col items-center text-center sm:mb-6">
          <MarcaTimVix className="text-base text-ink" tamanho={24} />
          <h1 className="mt-4 text-xl font-bold text-ink sm:mt-5 sm:text-2xl">Recuperar senha</h1>
          <p className="mt-1 text-sm text-ink-soft">Informe seu e-mail ou login para recuperar sua senha.</p>
        </div>

        <Cartao className="space-y-4 p-5 sm:p-7">
          {enviado ? (
            <div className="space-y-4">
              <div role="status" className="flex items-start gap-2.5 text-sm text-ink">
                <MailCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
                <div className="space-y-2">
                  <p className="font-medium">Pedido recebido.</p>
                  {CONFIRMACAO_DO_PEDIDO.map((texto) => (
                    <p key={texto} className="text-ink-soft">
                      {texto}
                    </p>
                  ))}
                </div>
              </div>
              <LinkBotao href={entrada} tamanho="lg" className="min-h-12 w-full">
                Voltar para a entrada
              </LinkBotao>
              <p className="text-center text-sm">
                <button
                  type="button"
                  onClick={() => setEnviado(false)}
                  className="inline-flex min-h-11 items-center font-medium text-accent hover:underline"
                >
                  Usar outro e-mail ou login
                </button>
              </p>
            </div>
          ) : (
            <>
              {conexaoExibida === "acordando" ? (
                <AvisoPreparandoAcesso />
              ) : (
                <FaixaConexao conexao={conexaoExibida} aoTentarDeNovo={recarregar} />
              )}
              <form onSubmit={(e) => void aoEnviar(e)} noValidate className="space-y-4">
                <div>
                  <label htmlFor="identificador" className="mb-1.5 block text-sm font-medium text-ink">
                    E-mail ou login
                  </label>
                  <input
                    id="identificador"
                    type="text"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    maxLength={254}
                    value={identificador}
                    onChange={(e) => setIdentificador(e.target.value)}
                    placeholder="Seu e-mail ou login"
                    aria-invalid={erro ? true : undefined}
                    aria-describedby={erro ? "erro-identificador" : undefined}
                    className={CAMPO}
                  />
                </div>
                {erro && (
                  <p id="erro-identificador" role="alert" className="text-sm text-[color:var(--color-danger)]">
                    {erro}
                  </p>
                )}
                <Botao type="submit" tamanho="lg" className="min-h-12 w-full" disabled={enviando || aguardandoServidor}>
                  <Send size={18} aria-hidden="true" />
                  {enviando ? "Enviando..." : aguardandoServidor ? "Aguardando o servidor..." : "Enviar link"}
                </Botao>
              </form>
            </>
          )}

          {/* Sempre visível e igual para todos: não depende do que foi digitado. */}
          <p className="flex items-start gap-2.5 border-t border-border pt-4 text-sm text-ink-soft">
            <UsersRound size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{ORIENTACAO_LOGIN_SEM_EMAIL}</span>
          </p>
        </Cartao>

        <p className="mt-4 text-center text-xs text-ink-soft">
          <Link href={entrada} className="inline-flex min-h-11 items-center underline hover:text-ink">
            ← Voltar para a entrada
          </Link>
        </p>
      </main>
    </div>
  );
}
