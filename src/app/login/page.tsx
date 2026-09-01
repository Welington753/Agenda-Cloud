"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Crown, Headset, KeyRound, ShieldCheck, Store, UserCog, UserRound, Users } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { autenticar, SENHA_DEMONSTRACAO } from "@/lib/auth/autenticacao";
import { ROTA_INICIAL_POR_PAPEL_ESTABELECIMENTO, ROTA_INICIAL_POR_PAPEL_PLATAFORMA } from "@/lib/permissions";
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
  const { entrarComo } = useAuth();
  const { notificar } = useToast();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [lembrar, setLembrar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  function preencherComConta(conta: ContaDemonstracao) {
    setEmail(conta.email);
    setSenha(SENHA_DEMONSTRACAO);
    setErro(null);
  }

  function aoEnviar(e: React.FormEvent) {
    e.preventDefault();
    setEntrando(true);
    setErro(null);

    const resultado = autenticar(email, senha);
    if (!resultado.ok) {
      setErro(resultado.erro);
      setEntrando(false);
      return;
    }

    // "Lembrar acesso" (estado `lembrar` acima) é só um rótulo nesta simulação —
    // a sessão já vive em sessionStorage independentemente do checkbox. Uma
    // autenticação real usaria isto para decidir entre um cookie de sessão curto
    // e um token de longa duração (refresh token).

    entrarComo(resultado.sessao);
    notificar(`Bem-vindo(a), ${resultado.sessao.nome.split(" ")[0]}.`, "sucesso");

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
        <p className="text-xs text-white/40">Protótipo de demonstração — autenticação simulada.</p>
      </div>

      <div className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm space-y-6">
          <div className="lg:hidden">
            <p className="text-sm font-semibold text-accent">{NOME_PRODUTO}</p>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink">Entrar</h1>
            <p className="mt-1 text-sm text-ink-soft">Acesso de gestores e equipe. Autenticação simulada.</p>
          </div>

          <form onSubmit={aoEnviar} className="space-y-4">
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

            {erro && <p className="text-sm text-[color:var(--color-danger)]">{erro}</p>}

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-ink-soft">
                <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
                Lembrar acesso
              </label>
              <button
                type="button"
                onClick={() =>
                  notificar("Recuperação de senha por e-mail ainda não existe nesta demonstração.", "info")
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

          <details className="rounded-[var(--radius-card)] border border-dashed border-border">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink">
              Acessos para demonstração
            </summary>
            <div className="space-y-4 border-t border-border px-4 py-4">
              <p className="text-xs text-ink-soft">
                Clique numa conta para preencher o formulário (senha de demonstração:{" "}
                <code className="rounded bg-paper-muted px-1 py-0.5">{SENHA_DEMONSTRACAO}</code>). Nenhuma senha real
                existe neste protótipo.
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
                        onClick={() => preencherComConta(conta)}
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
