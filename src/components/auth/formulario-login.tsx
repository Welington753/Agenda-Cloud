"use client";

// Formulário de login REAL (POST /auth/login, cookie HttpOnly), o mesmo na
// entrada da operação (`/login`) e na do portal da plataforma (`/portal`).
// Só autentica: para onde a pessoa vai depois é decisão de quem o usa, e o
// que cada área mostra continua decidido pelo servidor a cada leitura.
//
// A leitura de sessão da abertura (RealAuthProvider) é o acesso que acorda
// a API. Enquanto ela não responde, o envio espera: o login NUNCA é repetido
// sozinho, então mandá-lo para um servidor ainda dormindo só geraria um erro.
// O que foi digitado continua no formulário.
import { useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, KeyRound } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { FaixaConexao } from "@/components/conexao/aviso-conexao";
import { AvisoPreparandoAcesso } from "@/components/auth/aviso-preparando-acesso";
import { avisoDaConexao } from "@/lib/auth/conexao";

// Fonte de 16 px (abaixo disso o Safari do iPhone aproxima a tela ao focar) e
// 48 px de altura, acima do alvo de toque de 44 px.
const CAMPO =
  "min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3.5 py-3 text-base text-ink focus:border-accent";

export function FormularioLogin({
  aoEntrar,
  placeholder,
  dica,
  acaoSenha,
}: {
  aoEntrar: () => void;
  placeholder: string;
  /** Orientação sobre o login, recolhida em "Qual login devo usar?". */
  dica?: string;
  /** Ao lado do rótulo "Senha" (ex.: "Esqueci minha senha"). */
  acaoSenha?: ReactNode;
}) {
  const { login, estado, conexao, recarregar } = useRealAuth();
  const aguardandoServidor = conexao === "acordando" || conexao === "sem_internet";
  const conexaoExibida = avisoDaConexao(estado, conexao);
  const { notificar } = useToast();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    if (entrando || aguardandoServidor) return;
    setEntrando(true);
    setErro(null);

    const resultado = await login(email, senha);
    setEntrando(false);

    if (!resultado.ok) {
      switch (resultado.falha.tipo) {
        case "credenciais_invalidas":
          setErro("E-mail, usuário ou senha inválidos.");
          break;
        case "limite_tentativas":
          setErro("Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.");
          break;
        case "falha_comunicacao":
          setErro("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
          break;
        default:
          setErro("Não foi possível entrar agora. Tente novamente em instantes.");
      }
      return;
    }

    notificar(`Bem-vindo(a), ${resultado.dados.user.name.split(" ")[0]}.`, "sucesso");
    aoEntrar();
  }

  return (
    <>
      {/* Na abertura, um aviso curto só deste formulário (login e portal); os
          demais estados (sem internet, erro, "Tentar novamente") e as outras
          telas continuam com a faixa comum. O envio segue bloqueado. */}
      {conexaoExibida === "acordando" ? (
        <AvisoPreparandoAcesso />
      ) : (
        <FaixaConexao conexao={conexaoExibida} aoTentarDeNovo={recarregar} />
      )}

      <form onSubmit={(e) => void aoEnviar(e)} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">
            E-mail ou login
          </label>
          <input
            id="email"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={placeholder}
            className={CAMPO}
          />
          {/* `<details>` nativo: abre por toque, Enter ou Espaço, e o leitor
              de tela anuncia o estado (recolhido/expandido). */}
          {dica && (
            <details className="group mt-0.5 -mb-4 text-sm open:mb-0">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-[var(--radius-control)] font-medium text-accent hover:underline [&::-webkit-details-marker]:hidden">
                <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
                Qual login devo usar?
              </summary>
              <p className="mt-1 text-ink-soft">{dica}</p>
            </details>
          )}
        </div>
        <div>
          {/* Rótulo e ação na mesma linha; sem espaço, a ação desce para a
              linha de baixo (flex-wrap) em vez de sobrepor. */}
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3">
            <label htmlFor="senha" className="text-sm font-medium text-ink">
              Senha
            </label>
            {acaoSenha}
          </div>
          <input
            id="senha"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="••••••••"
            className={CAMPO}
          />
        </div>

        {erro && (
          <p role="alert" className="text-sm text-[color:var(--color-danger)]">
            {erro}
          </p>
        )}

        <Botao type="submit" tamanho="lg" className="min-h-12 w-full" disabled={entrando || aguardandoServidor}>
          <KeyRound size={18} aria-hidden="true" />
          {entrando ? "Entrando..." : aguardandoServidor ? "Aguardando o servidor..." : "Entrar"}
        </Botao>
      </form>
    </>
  );
}
