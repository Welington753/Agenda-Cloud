// Autenticação simulada. NADA aqui deve ser tratado como exemplo de autenticação
// real: não há hash, não há verificação de senha de verdade, não há sessão segura.
// Um backend real precisa validar credenciais no servidor, emitir um token
// assinado (JWT/cookie de sessão) e nunca aceitar o "tenantId" vindo do cliente.
//
// Toda conta de demonstração usa a mesma senha fixa abaixo — ela existe só para a
// tela de login ter uma validação de verdade (senha errada = erro), não porque
// alguém deveria "lembrar uma senha". Nenhuma senha real é armazenada em
// nenhum lugar do protótipo.

import { membershipRepository, usuarioEstabelecimentoRepository, usuarioPlataformaRepository } from "@/lib/repositories";
import type { SessaoUsuario } from "@/lib/types";

export const SENHA_DEMONSTRACAO = "demo123";

export type ResultadoAutenticacao = { ok: true; sessao: SessaoUsuario } | { ok: false; erro: string };

export function autenticar(emailDigitado: string, senhaDigitada: string): ResultadoAutenticacao {
  const email = emailDigitado.trim();
  if (!email || !senhaDigitada) {
    return { ok: false, erro: "Informe e-mail e senha." };
  }
  // Placeholder de autenticação: um backend real substituiria esta linha por uma
  // verificação de hash de senha no servidor.
  if (senhaDigitada !== SENHA_DEMONSTRACAO) {
    return { ok: false, erro: "E-mail ou senha inválidos." };
  }

  const usuarioPlataforma = usuarioPlataformaRepository.obterPorEmail(email);
  if (usuarioPlataforma) {
    if (usuarioPlataforma.status !== "ativo") {
      return { ok: false, erro: "Esta conta de administrador está suspensa." };
    }
    usuarioPlataformaRepository.atualizar(usuarioPlataforma.id, { ultimoAcessoSimuladoEm: new Date().toISOString() });
    return {
      ok: true,
      sessao: {
        id: usuarioPlataforma.id,
        nome: usuarioPlataforma.nome,
        email: usuarioPlataforma.email,
        escopo: "plataforma",
        papel: usuarioPlataforma.papel,
      },
    };
  }

  const usuarioEstabelecimento = usuarioEstabelecimentoRepository.obterPorEmail(email);
  if (usuarioEstabelecimento) {
    if (usuarioEstabelecimento.status !== "ativo") {
      return { ok: false, erro: "Esta conta ainda não está ativa (convite pendente) ou foi suspensa." };
    }
    const vinculo = membershipRepository.listarPorUsuario(usuarioEstabelecimento.id)[0];
    if (!vinculo) {
      return { ok: false, erro: "Esta conta não está vinculada a nenhum estabelecimento." };
    }
    usuarioEstabelecimentoRepository.atualizar(usuarioEstabelecimento.id, {
      ultimoAcessoSimuladoEm: new Date().toISOString(),
    });
    return {
      ok: true,
      sessao: {
        id: usuarioEstabelecimento.id,
        nome: usuarioEstabelecimento.nome,
        email: usuarioEstabelecimento.email,
        escopo: "estabelecimento",
        papel: vinculo.papel,
        tenantId: vinculo.tenantId,
        membershipId: vinculo.id,
        profissionalId: vinculo.profissionalId,
      },
    };
  }

  return { ok: false, erro: "E-mail ou senha inválidos." };
}
