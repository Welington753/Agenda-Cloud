"use client";

// Login (Lote 6C.1) — o formulário principal agora fala com o backend real
// (POST /auth/login, cookie HttpOnly). A demonstração continua existindo,
// mas como um fluxo EXPLICITAMENTE separado (ver seção "Acessos para
// demonstração" abaixo): clicar numa conta demo nunca preenche o formulário
// real para depois submetê-lo — isso tentaria autenticar um e-mail fictício
// contra o backend de verdade e falharia. Em vez disso, entra direto pela
// simulação local (`autenticar`/`entrarComo`, inalterados desde antes deste
// lote), sem nunca tocar a API real.
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Crown, Headset, KeyRound, ShieldCheck, Store, UserCog, UserRound, Users } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { autenticar, SENHA_DEMONSTRACAO } from "@/lib/auth/autenticacao";
import { ROTA_INICIAL_POR_PAPEL_ESTABELECIMENTO, ROTA_INICIAL_POR_PAPEL_PLATAFORMA } from "@/lib/permissions";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { ROTA_PADRAO_POS_LOGIN, sanitizarDestinoInterno } from "@/lib/auth/safe-redirect";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { NOME_PRODUTO } from "@/lib/config";
import type { PapelEstabelecimento, PapelPlataforma } from "@/lib/types";

interface ContaDemonstracao {
  grupo: "Administração da plataforma" | "Equipe dos estabelecimentos";
  nome: string;
  email: string;
  rotulo: string;
  icone: typeof Crown;
}

const CONTAS_DEMONSTRACAO: ContaDemonstracao[] = [
  { grupo: "Administração da plataforma", nome: "Ana Beatriz Ferreira", email: "ana.ferreira@agendabarber.com", rotulo: "MASTER_OWNER — controle total", icone: Crown },
  { grupo: "Administração da plataforma", nome: "Rodrigo Salles", email: "rodrigo.salles@agendabarber.com", rotulo: "MASTER_ADMIN — gerencia estabelecimentos", icone: UserCog },
  { grupo: "Administração da plataforma", nome: "Camila Duarte", email: "camila.duarte@agendabarber.com", rotulo: "MASTER_SUPPORT — acesso a suporte", icone: Headset },
  { grupo: "Equipe dos estabelecimentos", nome: "Marcelo Nogueira", email: "marcelo@domnavalha.com.br", rotulo: "Dono — Barbearia Dom Navalha", icone: Store },
  { grupo: "Equipe dos estabelecimentos", nome: "Juliana Prado", email: "juliana@domnavalha.com.br", rotulo: "Gerente — Barbearia Dom Navalha", icone: Users },
  { grupo: "Equipe dos estabelecimentos", nome: "Débora Alves", email: "debora@domnavalha.com.br", rotulo: "Recepcionista — Barbearia Dom Navalha", icone: Users },
  { grupo: "Equipe dos estabelecimentos", nome: "João Silva", email: "joao.silva@domnavalha.com.br", rotulo: "Profissional — Barbearia Dom Navalha", icone: UserRound },
  { grupo: "Equipe dos estabelecimentos", nome: "Dra. Mariana Alves", email: "mariana@sorrisoleve.com.br", rotulo: "Dona — Clínica Sorriso Leve", icone: Building2 },
  { grupo: "Equipe dos estabelecimentos", nome: "Bastião Nunes", email: "bastiao@barbeirobastiao.com.br", rotulo: "Dono e profissional — Barbeiro Bastião (plano Essencial)", icone: UserRound },
];

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageConteudo />
    </Suspense>
  );
}

// `useSearchParams` (para `?next=`) exige um limite de Suspense em builds de
// produção (ver node_modules/next/dist/docs, "Missing Suspense boundary with
// useSearchParams") — por isso o conteúdo real fica separado do export
// default acima.
function LoginPageConteudo() {
  const { entrarComo } = useAuth();
  const { login } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  function destinoPosLogin(): string {
    const next = sanitizarDestinoInterno(searchParams.get("next"));
    return next ?? ROTA_PADRAO_POS_LOGIN;
  }

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    if (entrando) return;
    setEntrando(true);
    setErro(null);

    const resultado = await login(email, senha);
    setEntrando(false);

    if (!resultado.ok) {
      switch (resultado.falha.tipo) {
        case "credenciais_invalidas":
          setErro("E-mail ou senha inválidos.");
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
    router.push(destinoPosLogin());
  }

  function entrarComContaDemonstracao(conta: ContaDemonstracao) {
    const resultado = autenticar(conta.email, SENHA_DEMONSTRACAO);
    if (!resultado.ok) return;
    entrarComo(resultado.sessao);
    notificar(`Bem-vindo(a), ${resultado.sessao.nome.split(" ")[0]}. (ambiente de demonstração)`, "sucesso");
    const destino =
      resultado.sessao.escopo === "plataforma"
        ? ROTA_INICIAL_POR_PAPEL_PLATAFORMA[resultado.sessao.papel as PapelPlataforma]
        : ROTA_INICIAL_POR_PAPEL_ESTABELECIMENTO[resultado.sessao.papel as PapelEstabelecimento];
    router.push(destino);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink p-10 text-white lg:flex">
        <div>
          <p className="font-bold tracking-tight">{NOME_PRODUTO}</p>
        </div>
        <div className="max-w-sm space-y-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-white/10">
            <ShieldCheck size={24} />
          </div>
          <h2 className="text-2xl font-bold">Acesso reservado à equipe</h2>
          <p className="text-sm text-white/70">
            Esta é a porta de entrada para administradores da plataforma e para a equipe de cada estabelecimento
            (donos, gerentes, recepcionistas e profissionais). Consumidores finais nunca precisam fazer login — eles
            agendam direto pela página pública do estabelecimento.
          </p>
        </div>
        <p className="text-xs text-white/40">Protótipo em transição para autenticação real.</p>
      </div>

      <div className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm space-y-6">
          <div className="lg:hidden">
            <p className="text-sm font-semibold text-accent">{NOME_PRODUTO}</p>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink">Entrar</h1>
            <p className="mt-1 text-sm text-ink-soft">Acesso de gestores e equipe.</p>
          </div>

          <form onSubmit={(e) => void aoEnviar(e)} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@seuestabelecimento.com.br"
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent"
              />
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
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent"
              />
            </div>

            {erro && (
              <p role="alert" className="text-sm text-[color:var(--color-danger)]">
                {erro}
              </p>
            )}

            <div className="flex items-center justify-end text-sm">
              <button
                type="button"
                onClick={() =>
                  notificar("Recuperação de senha por e-mail ainda não existe nesta fase.", "info")
                }
                className="font-medium text-accent hover:underline"
              >
                Esqueci minha senha
              </button>
            </div>

            <Botao type="submit" className="w-full" disabled={entrando}>
              <KeyRound size={16} className="mr-1.5" />
              {entrando ? "Entrando..." : "Entrar"}
            </Botao>
          </form>

          {/* Cadastro real (Lote 6C.2) — outra conta de verdade, nunca a
              demonstração abaixo. */}
          <p className="text-center text-sm text-ink-soft">
            Ainda não tem conta?{" "}
            <Link href="/cadastro" className="font-medium text-accent hover:underline">
              Criar conta
            </Link>
          </p>

          <details className="rounded-[var(--radius-card)] border border-dashed border-border">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink">
              Ambiente de demonstração (sem conta real)
            </summary>
            <div className="space-y-4 border-t border-border px-4 py-4">
              <p className="text-xs text-ink-soft">
                Clique numa conta para entrar direto num ambiente simulado, sem senha e sem se conectar ao servidor
                real. Nenhuma destas contas existe de verdade — são só para navegar pelas telas.
              </p>
              {(["Administração da plataforma", "Equipe dos estabelecimentos"] as const).map((grupo) => (
                <div key={grupo} className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{grupo}</p>
                  {CONTAS_DEMONSTRACAO.filter((c) => c.grupo === grupo).map((conta) => {
                    const Icone = conta.icone;
                    return (
                      <button
                        key={conta.email}
                        type="button"
                        onClick={() => entrarComContaDemonstracao(conta)}
                        className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-xs hover:bg-paper-muted"
                      >
                        <Icone size={14} className="shrink-0 text-ink-soft" />
                        <span className="min-w-0 flex-1 truncate font-medium text-ink">{conta.nome}</span>
                        <span className="shrink-0 text-ink-soft">{conta.rotulo}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </details>

          <Cartao className="border-dashed">
            <CartaoCorpo className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper-muted text-ink-soft">
                <Store size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">Você é um consumidor?</p>
                <p className="text-xs text-ink-soft">Não é preciso login para agendar um horário.</p>
              </div>
              <Link href="/dom-navalha" className="shrink-0 text-xs font-semibold text-accent hover:underline">
                Ver exemplo
              </Link>
            </CartaoCorpo>
          </Cartao>

          <p className="text-center text-xs text-ink-soft">
            <Link href="/" className="underline hover:text-ink">
              ← Voltar para a apresentação
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
