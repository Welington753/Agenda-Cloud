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
import { KeyRound } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { FaixaConexao } from "@/components/conexao/aviso-conexao";

const CAMPO =
  "w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent";

export function FormularioLogin({
  aoEntrar,
  placeholder,
  dica,
  extra,
}: {
  aoEntrar: () => void;
  placeholder: string;
  dica?: string;
  /** Entre a senha e o botão (ex.: "Esqueci minha senha"). */
  extra?: ReactNode;
}) {
  const { login, estado, conexao, recarregar } = useRealAuth();
  const aguardandoServidor = conexao === "acordando" || conexao === "sem_internet";
  const conexaoExibida = estado.status === "falha_comunicacao" ? "sem_resposta" : conexao;
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
      <FaixaConexao conexao={conexaoExibida} aoTentarDeNovo={recarregar} />

      <form onSubmit={(e) => void aoEnviar(e)} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink">
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
            aria-describedby={dica ? "dica-login" : undefined}
            className={CAMPO}
          />
          {dica && (
            <p id="dica-login" className="mt-1 text-xs text-ink-soft">
              {dica}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="senha" className="mb-1 block text-sm font-medium text-ink">
            Senha
          </label>
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

        {extra}

        <Botao type="submit" className="w-full" disabled={entrando || aguardandoServidor}>
          <KeyRound size={16} className="mr-1.5" />
          {entrando ? "Entrando..." : aguardandoServidor ? "Aguardando o servidor..." : "Entrar"}
        </Botao>
      </form>
    </>
  );
}
