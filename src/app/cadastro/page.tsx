"use client";

// Cadastro REAL (Lote 6C.2) — única tela que chama POST /auth/register.
// Reaproveita inteiramente a infraestrutura já existente: `http-client`
// (cookies via `credentials: "include"`), `auth-api` e o contexto de sessão
// real (`real-auth-context`). Nada de autenticação é duplicado aqui.
//
// Nunca guarda senha nem token em localStorage/sessionStorage/estado demo — a
// senha só existe no `useState` do formulário enquanto a tela está aberta e
// viaja apenas no corpo do POST. A sessão vem sempre do cookie HttpOnly +
// /auth/me, nunca da resposta do cadastro.
//
// Nenhum campo, preço, verificação de e-mail/telefone ou regra de senha é
// inventado: o formulário é exatamente `backend/src/auth/register.dto.ts`.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, UserPlus } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { MENSAGEM_SESSAO_PENDENTE, mensagemFalhaCadastro } from "@/lib/auth/cadastro-fluxo";
import {
  SENHA_MIN,
  formularioEhValido,
  paraDadosCadastro,
  validarCadastro,
  type ErrosCadastro,
  type FormularioCadastro,
} from "@/lib/auth/cadastro-validacao";
import { ROTA_PADRAO_POS_LOGIN } from "@/lib/auth/safe-redirect";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { NOME_PRODUTO } from "@/lib/config";
import { CampoCadastro } from "./campo-cadastro";

const FORMULARIO_VAZIO: FormularioCadastro = {
  ownerName: "",
  businessName: "",
  email: "",
  phone: "",
  password: "",
};

export default function CadastroPage() {
  const { cadastrar, restaurarSessao } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();

  const [formulario, setFormulario] = useState<FormularioCadastro>(FORMULARIO_VAZIO);
  const [erros, setErros] = useState<ErrosCadastro>({});
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  // `enviando` cobre tanto o POST /auth/register quanto o /auth/me que vem
  // depois — o botão fica desabilitado o tempo todo, e `aoEnviar` ainda
  // retorna cedo se for chamado de novo (dois cliques rápidos, Enter repetido).
  const [enviando, setEnviando] = useState(false);
  // Cadastro confirmado pelo servidor, mas sessão ainda não carregada. A
  // partir daqui o formulário some: reenviar o cadastro só produziria um 409.
  const [sessaoPendente, setSessaoPendente] = useState(false);
  const [recuperando, setRecuperando] = useState(false);

  function alterar(campo: keyof FormularioCadastro, valor: string) {
    setFormulario((atual) => ({ ...atual, [campo]: valor }));
    // Só limpa o erro do campo que está sendo corrigido; nunca revalida o
    // formulário inteiro a cada tecla (isso marcaria como inválido um campo
    // que o usuário ainda nem preencheu).
    setErros((atual) => (atual[campo] ? { ...atual, [campo]: undefined } : atual));
  }

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando || sessaoPendente) return;

    const errosValidacao = validarCadastro(formulario);
    setErros(errosValidacao);
    setErroEnvio(null);
    if (!formularioEhValido(errosValidacao)) return;

    setEnviando(true);
    const resultado = await cadastrar(paraDadosCadastro(formulario));
    setEnviando(false);

    if (resultado.etapa === "cadastro_falhou") {
      setErroEnvio(mensagemFalhaCadastro(resultado.falha));
      return;
    }
    if (resultado.etapa === "sessao_pendente") {
      // Conta criada. Nunca voltar ao formulário e nunca repetir o POST.
      setFormulario(FORMULARIO_VAZIO);
      setSessaoPendente(true);
      return;
    }

    setFormulario(FORMULARIO_VAZIO);
    notificar(`Conta criada. Bem-vindo(a), ${resultado.sessao.user.name.split(" ")[0]}.`, "sucesso");
    router.push(ROTA_PADRAO_POS_LOGIN);
  }

  async function aoRecuperarSessao() {
    if (recuperando) return;
    setRecuperando(true);
    const resultado = await restaurarSessao();
    setRecuperando(false);

    if (resultado.etapa === "concluido") {
      notificar(`Sessão restaurada. Bem-vindo(a), ${resultado.sessao.user.name.split(" ")[0]}.`, "sucesso");
      router.push(ROTA_PADRAO_POS_LOGIN);
      return;
    }
    setErroEnvio("Ainda não foi possível carregar sua sessão. Sua conta continua criada — tente de novo ou entre.");
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
          <h2 className="text-2xl font-bold">Crie a conta do seu estabelecimento</h2>
          <p className="text-sm text-white/70">
            Você cria a conta do dono e o estabelecimento no mesmo passo. Depois disso, a sessão fica ativa neste
            navegador e você acessa a área da sua conta.
          </p>
        </div>
        <p className="text-xs text-white/40">Cadastro conectado ao servidor real.</p>
      </div>

      <div className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm space-y-6">
          <div className="lg:hidden">
            <p className="text-sm font-semibold text-accent">{NOME_PRODUTO}</p>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink">Criar conta</h1>
            <p className="mt-1 text-sm text-ink-soft">Leva menos de um minuto.</p>
          </div>

          {sessaoPendente ? (
            <div className="space-y-4">
              <p role="alert" className="text-sm text-ink">
                {MENSAGEM_SESSAO_PENDENTE}
              </p>
              {erroEnvio && (
                <p role="alert" className="text-sm text-[color:var(--color-danger)]">
                  {erroEnvio}
                </p>
              )}
              <Botao
                type="button"
                className="w-full"
                disabled={recuperando}
                aria-busy={recuperando}
                onClick={() => void aoRecuperarSessao()}
              >
                {recuperando ? "Recuperando sessão..." : "Recuperar sessão"}
              </Botao>
              <p className="text-center text-sm text-ink-soft">
                <Link href="/login" className="font-medium text-accent hover:underline">
                  Entrar com a conta criada
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={(evento) => void aoEnviar(evento)} className="space-y-4" noValidate>
              <CampoCadastro
                id="ownerName"
                rotulo="Seu nome"
                type="text"
                autoComplete="name"
                value={formulario.ownerName}
                onChange={(evento) => alterar("ownerName", evento.target.value)}
                erro={erros.ownerName}
                placeholder="Maria Souza"
              />
              <CampoCadastro
                id="businessName"
                rotulo="Nome do estabelecimento"
                type="text"
                autoComplete="organization"
                value={formulario.businessName}
                onChange={(evento) => alterar("businessName", evento.target.value)}
                erro={erros.businessName}
                placeholder="Studio Bela"
              />
              <CampoCadastro
                id="email"
                rotulo="E-mail"
                type="email"
                autoComplete="email"
                value={formulario.email}
                onChange={(evento) => alterar("email", evento.target.value)}
                erro={erros.email}
                placeholder="voce@seuestabelecimento.com.br"
              />
              <CampoCadastro
                id="phone"
                rotulo="Telefone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={formulario.phone}
                onChange={(evento) => alterar("phone", evento.target.value)}
                erro={erros.phone}
                dica="Com DDD. Ex.: (11) 99999-8888"
                placeholder="(11) 99999-8888"
              />
              <CampoCadastro
                id="password"
                rotulo="Senha"
                type="password"
                autoComplete="new-password"
                value={formulario.password}
                onChange={(evento) => alterar("password", evento.target.value)}
                erro={erros.password}
                dica={`Mínimo de ${SENHA_MIN} caracteres.`}
                placeholder="••••••••••"
              />

              {erroEnvio && (
                <p role="alert" className="text-sm text-[color:var(--color-danger)]">
                  {erroEnvio}
                </p>
              )}

              <Botao type="submit" className="w-full" disabled={enviando} aria-busy={enviando}>
                <UserPlus size={16} className="mr-1.5" />
                {enviando ? "Criando conta..." : "Criar conta"}
              </Botao>
            </form>
          )}

          <p className="text-center text-sm text-ink-soft">
            Já tem uma conta?{" "}
            <Link href="/login" className="font-medium text-accent hover:underline">
              Entrar
            </Link>
          </p>

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
