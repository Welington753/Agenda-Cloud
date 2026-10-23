"use client";

// Aceite de convite: a única entrada pública de conta nova. Abrir esta página
// só CONSULTA o convite (POST /invites/preview); nada é consumido até o
// envio explícito do formulário (POST /invites/accept).
//
// - Conta nova: a pessoa cria a própria senha (com confirmação). O link
//   prova que o e-mail é dela; a conta é ativada e a sessão aberta.
// - Conta existente: confirma com a senha ATUAL; nada da conta muda, só o
//   vínculo novo é criado.
//
// A senha nunca é guardada no navegador. Resposta perdida no aceite: a tela
// não repete sozinha; orienta a conferir (o convite pode já ter sido aceito).
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { apiRequest } from "@/lib/api/http-client";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { useTokenDoLink } from "@/lib/auth/link-do-email";
import { erroDaSenhaNova } from "@/lib/auth/senha";
import { NOME_PRODUTO } from "@/lib/config";

interface Previa {
  status: "VALID" | "INVALID" | "EXPIRED" | "REVOKED" | "ACCEPTED" | "UNAVAILABLE";
  type?: "ESTABLISHMENT" | "PLATFORM";
  targetName?: string;
  targetEmail?: string;
  tenantName?: string | null;
  accountExists?: boolean;
}

const MENSAGEM_ESTADO: Record<Exclude<Previa["status"], "VALID">, string> = {
  INVALID: "Este link de convite não é válido. Confira se abriu o link completo do e-mail.",
  EXPIRED: "Este convite expirou. Peça um novo link à administração.",
  REVOKED: "Este convite foi cancelado pela administração.",
  ACCEPTED: "Este convite já foi usado. Se foi você, entre com a sua senha.",
  UNAVAILABLE: "Este convite não pode ser aceito agora. Fale com a administração.",
};

const CAMPO = "mt-1 min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-card px-3.5 text-sm text-ink";

export default function ConvitePage() {
  const token = useTokenDoLink();
  const router = useRouter();
  const { restaurarSessao } = useRealAuth();
  const [previa, setPrevia] = useState<Previa | "carregando" | "rede">("carregando");
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
    void apiRequest<Previa>("/invites/preview", { method: "POST", body: { token } }).then((r) => {
      if (r.kind === "success") setPrevia(r.data);
      else if (r.kind === "network-error") setPrevia("rede");
      else setPrevia({ status: "INVALID" });
    });
  }, [token]);

  async function aceitar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando || typeof previa !== "object" || !token) return;
    if (!previa.accountExists) {
      const problema = erroDaSenhaNova(senha, confirmacao);
      if (problema) {
        setErro(problema);
        return;
      }
    }
    setErro("");
    setEnviando(true);
    const r = await apiRequest<{ destination: string }>("/invites/accept", { method: "POST", body: { token, password: senha } });
    if (r.kind === "success") {
      setSenha("");
      setConfirmacao("");
      await restaurarSessao();
      router.replace(r.data.destination);
      return;
    }
    setEnviando(false);
    if (r.kind === "network-error") {
      setErro("A resposta não chegou. O convite pode ter sido aceito: tente entrar antes de enviar de novo.");
      return;
    }
    const codigo = (r.data as { code?: string; message?: string } | null)?.code;
    if (r.status === 401) setErro(previa.accountExists ? "Senha incorreta para esta conta." : "Não foi possível confirmar.");
    else if (r.status === 429) setErro("Muitas tentativas. Aguarde alguns minutos.");
    else if (r.status === 400) setErro("A senha precisa ter entre 10 e 128 caracteres.");
    else if (codigo === "JA_VINCULADO") setErro("Esta conta já tem acesso a este estabelecimento. Entre normalmente.");
    else if (r.status === 410 || r.status === 404) {
      const estado = (codigo?.replace("CONVITE_", "") ?? "INVALID") as Exclude<Previa["status"], "VALID">;
      setPrevia({ status: MENSAGEM_ESTADO[estado] ? estado : "INVALID" });
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
                Conferindo o convite…
              </p>
            ) : previa === "rede" ? (
              <p role="alert" className="text-sm">
                Não foi possível falar com o servidor. Recarregue a página para tentar de novo.
              </p>
            ) : previa.status !== "VALID" ? (
              <>
                <h1 className="text-lg font-bold text-ink">Convite indisponível</h1>
                <p role="alert" className="text-sm">
                  {MENSAGEM_ESTADO[previa.status]}
                </p>
                <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-medium text-accent">
                  Ir para o login
                </Link>
              </>
            ) : (
              <form onSubmit={(e) => void aceitar(e)} className="space-y-4">
                <h1 className="text-lg font-bold text-ink">
                  {previa.tenantName ? `Convite para ${previa.tenantName}` : "Convite para a administração da plataforma"}
                </h1>
                <p className="text-sm text-ink-soft">
                  {previa.targetName}, este convite é para <span className="break-all font-medium text-ink">{previa.targetEmail}</span>.
                </p>
                <label className="block text-sm font-medium text-ink">
                  {previa.accountExists ? "Senha da sua conta" : "Crie sua senha"}
                  <input
                    type="password"
                    required
                    autoComplete={previa.accountExists ? "current-password" : "new-password"}
                    minLength={10}
                    maxLength={128}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className={CAMPO}
                  />
                </label>
                {!previa.accountExists && (
                  <label className="block text-sm font-medium text-ink">
                    Repita a senha
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      maxLength={128}
                      value={confirmacao}
                      onChange={(e) => setConfirmacao(e.target.value)}
                      className={CAMPO}
                    />
                  </label>
                )}
                <p className="text-xs text-ink-soft">
                  {previa.accountExists
                    ? "Você já tem conta: confirme com a senha atual. Nada na sua conta muda além do novo acesso."
                    : "Mínimo de 10 caracteres. Ninguém da administração conhece esta senha."}
                </p>
                {erro && (
                  <p role="alert" className="text-sm text-danger">
                    {erro}
                  </p>
                )}
                <Botao type="submit" className="w-full" disabled={enviando}>
                  {enviando ? "Confirmando…" : previa.accountExists ? "Aceitar o convite" : "Ativar minha conta"}
                </Botao>
              </form>
            )}
          </CartaoCorpo>
        </Cartao>
      </div>
    </main>
  );
}
