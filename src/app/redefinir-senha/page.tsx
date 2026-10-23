"use client";

// Redefinição de senha pelo link que a administração mandou ao e-mail da
// conta. Abrir a página só consulta o link; a senha nova só é gravada no
// envio do formulário. Depois disso as sessões abertas são encerradas e a
// pessoa entra com a senha nova (esta página não abre sessão).
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Botao, LinkBotao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { apiRequest } from "@/lib/api/http-client";
import { useTokenDoLink } from "@/lib/auth/link-do-email";
import { erroDaSenhaNova } from "@/lib/auth/senha";
import { NOME_PRODUTO } from "@/lib/config";

type Estado = "VALID" | "INVALID" | "EXPIRED" | "USED" | "REVOKED" | "UNAVAILABLE";

const MENSAGEM: Record<Exclude<Estado, "VALID">, string> = {
  INVALID: "Este link não é válido. Confira se abriu o link completo do e-mail.",
  EXPIRED: "Este link expirou. Peça outro à administração.",
  USED: "Este link já foi usado.",
  REVOKED: "Este link foi substituído por outro mais recente. Use o último e-mail recebido.",
  UNAVAILABLE: "Esta conta não pode redefinir a senha agora. Fale com a administração.",
};

const CAMPO = "mt-1 min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-card px-3.5 text-sm text-ink";

export default function RedefinirSenhaPage() {
  const token = useTokenDoLink();
  const [previa, setPrevia] = useState<{ status: Estado; name?: string; email?: string } | "carregando" | "rede" | "concluida">(
    "carregando",
  );
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <p className="text-center text-xl font-bold text-ink">{NOME_PRODUTO}</p>
        <Cartao>
          <CartaoCorpo className="space-y-4">
            {previa === "carregando" ? (
              <p role="status" className="text-sm text-ink-soft">
                Conferindo o link…
              </p>
            ) : previa === "rede" ? (
              <p role="alert" className="text-sm">
                Não foi possível falar com o servidor. Recarregue a página para tentar de novo.
              </p>
            ) : previa === "concluida" ? (
              <>
                <h1 className="text-lg font-bold text-ink">Senha alterada</h1>
                <p role="status" className="text-sm">
                  Sua senha nova já vale. As sessões abertas com a senha antiga foram encerradas.
                </p>
                <LinkBotao href="/login" className="w-full">
                  Entrar
                </LinkBotao>
              </>
            ) : previa.status !== "VALID" ? (
              <>
                <h1 className="text-lg font-bold text-ink">Link indisponível</h1>
                <p role="alert" className="text-sm">
                  {MENSAGEM[previa.status]}
                </p>
                <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-medium text-accent">
                  Ir para o login
                </Link>
              </>
            ) : (
              <form onSubmit={(e) => void salvar(e)} className="space-y-4">
                <h1 className="text-lg font-bold text-ink">Criar uma senha nova</h1>
                <p className="text-sm text-ink-soft">
                  {previa.name}, a senha nova vale para <span className="break-all font-medium text-ink">{previa.email}</span>.
                </p>
                <label className="block text-sm font-medium text-ink">
                  Senha nova
                  <input type="password" required autoComplete="new-password" minLength={10} maxLength={128} value={senha} onChange={(e) => setSenha(e.target.value)} className={CAMPO} />
                </label>
                <label className="block text-sm font-medium text-ink">
                  Repita a senha nova
                  <input type="password" required autoComplete="new-password" maxLength={128} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} className={CAMPO} />
                </label>
                {erro && (
                  <p role="alert" className="text-sm text-danger">
                    {erro}
                  </p>
                )}
                <Botao type="submit" className="w-full" disabled={enviando}>
                  {enviando ? "Salvando…" : "Salvar senha nova"}
                </Botao>
              </form>
            )}
          </CartaoCorpo>
        </Cartao>
      </div>
    </main>
  );
}
