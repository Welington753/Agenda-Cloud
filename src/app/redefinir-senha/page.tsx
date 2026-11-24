"use client";

// Redefinição de senha pelo link do e-mail, venha ele da administração ou de
// "Esqueci minha senha". Abrir a página só consulta o link; a senha nova só é
// gravada no envio do formulário. Depois disso as sessões abertas são
// encerradas e a pessoa volta ao login (esta página não abre sessão). O
// segundo fator, se ativo, continua sendo pedido no próximo login.
//
// Mesma coluna única do login, nos quatro temas (só tokens).
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Botao, LinkBotao } from "@/components/ui/button";
import { Cartao } from "@/components/ui/card";
import { MarcaTimVix } from "@/components/marca/marca";
import { apiRequest } from "@/lib/api/http-client";
import { useTokenDoLink } from "@/lib/auth/link-do-email";
import { SENHA_MIN, erroDaSenhaNova } from "@/lib/auth/senha";
import { linkEsqueciSenha } from "@/lib/auth/recuperacao-senha";

type Estado = "VALID" | "INVALID" | "EXPIRED" | "USED" | "REVOKED" | "UNAVAILABLE";

const MENSAGEM: Record<Exclude<Estado, "VALID">, string> = {
  INVALID: "Este link não é válido. Confira se abriu o link completo do e-mail.",
  EXPIRED: "Este link expirou. Peça um novo em \"Esqueci minha senha\".",
  USED: "Este link já foi usado.",
  REVOKED: "Este link não vale mais. Use o e-mail mais recente ou peça um novo link.",
  UNAVAILABLE: "Esta conta não pode redefinir a senha agora. Fale com o responsável pelo estabelecimento.",
};

// Mesmo campo do login: 16 px (sem zoom no iPhone) e 48 px de altura.
const CAMPO =
  "min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3.5 py-3 text-base text-ink focus:border-accent";

type Previa = { status: Estado; name?: string; email?: string } | "carregando" | "rede" | "concluida";

export default function RedefinirSenhaPage() {
  const token = useTokenDoLink();
  const [previa, setPrevia] = useState<Previa>("carregando");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (token === undefined) return;
    if (token === null) {
      setPrevia({ status: "INVALID" });
      return;
    }
    void apiRequest<{ status: Estado; name?: string; email?: string }>("/password-resets/preview", {
      method: "POST",
      body: { token },
    }).then((r) => {
      if (r.kind === "success") setPrevia(r.data);
      else if (r.kind === "network-error") setPrevia("rede");
      else setPrevia({ status: "INVALID" });
    });
  }, [token]);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando || !token) return;
    const problema = erroDaSenhaNova(senha, confirmacao);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro("");
    setEnviando(true);
    const r = await apiRequest<null>("/password-resets/complete", { method: "POST", body: { token, password: senha } });
    setEnviando(false);
    if (r.kind === "success") {
      setSenha("");
      setConfirmacao("");
      setPrevia("concluida");
    } else if (r.kind === "network-error") {
      setErro("A resposta não chegou. A senha pode ter sido trocada: tente entrar com a senha nova antes de repetir.");
    } else if (r.status === 429) setErro("Muitas tentativas. Aguarde alguns minutos.");
    else if (r.status === 410 || r.status === 404) {
      const codigo = (r.data as { code?: string } | null)?.code?.replace("LINK_", "") as Exclude<Estado, "VALID"> | undefined;
      setPrevia({ status: codigo && MENSAGEM[codigo] ? codigo : "INVALID" });
    } else setErro("O servidor não conseguiu concluir. Tente de novo em instantes.");
  }

  const titulo =
    previa === "carregando"
      ? "Conferindo o link"
      : previa === "rede"
        ? "Sem conexão"
        : previa === "concluida"
          ? "Senha alterada"
          : previa.status === "VALID"
            ? "Criar nova senha"
            : "Link indisponível";

  return (
    <div className="flex min-h-dvh flex-col px-4 py-6 sm:px-6 sm:py-10">
      <main className="mx-auto my-auto w-full max-w-md">
        <div className="mb-5 flex flex-col items-center text-center sm:mb-6">
          <MarcaTimVix className="text-base text-ink" tamanho={24} />
          <h1 className="mt-4 text-xl font-bold text-ink sm:mt-5 sm:text-2xl">{titulo}</h1>
        </div>

        <Cartao className="space-y-4 p-5 sm:p-7">
          {previa === "carregando" ? (
            <p role="status" className="text-sm text-ink-soft">
              Conferindo o link…
            </p>
          ) : previa === "rede" ? (
            <p role="alert" className="text-sm text-ink">
              Não foi possível falar com o servidor. Recarregue a página para tentar de novo.
            </p>
          ) : previa === "concluida" ? (
            <>
              <div role="status" className="space-y-2 text-sm text-ink">
                <p>Sua nova senha já vale. As sessões abertas com a senha anterior foram encerradas.</p>
                <p className="text-ink-soft">Se a verificação em duas etapas estiver ativa, ela continua sendo pedida ao entrar.</p>
              </div>
              <LinkBotao href="/login" tamanho="lg" className="min-h-12 w-full">
                Ir para o login
              </LinkBotao>
              <p className="text-center text-sm">
                <Link href="/portal" className="inline-flex min-h-11 items-center font-medium text-accent hover:underline">
                  Entrar no portal da plataforma
                </Link>
              </p>
            </>
          ) : previa.status !== "VALID" ? (
            <>
              <p role="alert" className="text-sm text-ink">
                {MENSAGEM[previa.status]}
              </p>
              <LinkBotao href={linkEsqueciSenha("login")} tamanho="lg" className="min-h-12 w-full">
                Pedir um novo link
              </LinkBotao>
            </>
          ) : (
            <form onSubmit={(e) => void salvar(e)} className="space-y-4">
              <p className="text-sm text-ink-soft">
                A nova senha vale para <span className="break-all font-medium text-ink">{previa.email}</span>.
              </p>
              <div>
                <label htmlFor="senha-nova" className="mb-1.5 block text-sm font-medium text-ink">
                  Nova senha
                </label>
                <input
                  id="senha-nova"
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={SENHA_MIN}
                  maxLength={128}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  aria-describedby="regra-senha"
                  className={CAMPO}
                />
                <p id="regra-senha" className="mt-1 text-xs text-ink-soft">
                  Pelo menos {SENHA_MIN} caracteres.
                </p>
              </div>
              <div>
                <label htmlFor="senha-confirmacao" className="mb-1.5 block text-sm font-medium text-ink">
                  Confirmar senha
                </label>
                <input
                  id="senha-confirmacao"
                  type="password"
                  required
                  autoComplete="new-password"
                  maxLength={128}
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  className={CAMPO}
                />
              </div>
              {erro && (
                <p role="alert" className="text-sm text-[color:var(--color-danger)]">
                  {erro}
                </p>
              )}
              <Botao type="submit" tamanho="lg" className="min-h-12 w-full" disabled={enviando}>
                <KeyRound size={18} aria-hidden="true" />
                {enviando ? "Salvando…" : "Salvar nova senha"}
              </Botao>
            </form>
          )}
        </Cartao>

        <p className="mt-4 text-center text-xs text-ink-soft">
          <Link href="/login" className="inline-flex min-h-11 items-center underline hover:text-ink">
            ← Voltar para o login
          </Link>
        </p>
      </main>
    </div>
  );
}
