"use client";

// Sessão simulada para o protótipo: NÃO há senha real, token ou verificação de
// servidor. A "sessão" é apenas um registro em sessionStorage para permitir
// navegar pelas telas como cada perfil. Um backend real precisará validar
// credenciais, emitir tokens assinados e checar `tenantId` no servidor — nunca
// confiar no que a UI envia. Ver `src/lib/auth/autenticacao.ts` para a simulação
// de login em si.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SessaoUsuario } from "@/lib/types";

const CHAVE_SESSAO = "agenda-barber:v3:sessao-usuario";

interface AuthContextValue {
  usuario: SessaoUsuario | null;
  carregando: boolean;
  entrarComo: (usuario: SessaoUsuario) => void;
  sair: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function lerSessao(): SessaoUsuario | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(CHAVE_SESSAO);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessaoUsuario;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<SessaoUsuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    setUsuario(lerSessao());
    setCarregando(false);
  }, []);

  function entrarComo(novoUsuario: SessaoUsuario) {
    window.sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(novoUsuario));
    setUsuario(novoUsuario);
  }

  function sair() {
    window.sessionStorage.removeItem(CHAVE_SESSAO);
    setUsuario(null);
  }

  return <AuthContext.Provider value={{ usuario, carregando, entrarComo, sair }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const contexto = useContext(AuthContext);
  if (!contexto) throw new Error("useAuth precisa ser usado dentro de <AuthProvider>");
  return contexto;
}

/** Só deve ser usado em rotas já protegidas por <RequireRole> para papéis de
 * estabelecimento, onde o tenantId é garantido. Nunca confiar em tenantId vindo
 * de outra fonte (URL, query string) sem cruzar com a sessão simulada. */
export function useTenantId(): string {
  const { usuario } = useAuth();
  if (!usuario?.tenantId) throw new Error("tenantId ausente para o usuário logado");
  return usuario.tenantId;
}
