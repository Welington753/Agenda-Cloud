"use client";

// Acesso à administração da plataforma, lido UMA vez por sessão para toda a
// área real: o menu (shell-conta.tsx) decide se mostra "Administração" e o
// portão das páginas (`/conta/administracao/**`) usa a mesma resposta, sem
// uma segunda consulta.
//
// Vem só de `GET /platform/access`, que o backend calcula a partir do papel e
// das permissões de plataforma relidos do banco. Nada aqui olha e-mail, nome
// ou vínculo com estabelecimento. É só apresentação: cada leitura de dados da
// administração é autorizada de novo no servidor, e um papel revogado vira
// 403 ali mesmo que o item continue no menu até a próxima leitura.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ehAcesso } from "./contratos";
import { useLeituraPlataforma, type LeituraPlataforma } from "./use-leitura-plataforma";

interface AcessoPlataforma {
  estado: LeituraPlataforma<{ canViewEstablishments: boolean }>;
  recarregar: () => void;
}

const Contexto = createContext<AcessoPlataforma | null>(null);

export function AcessoPlataformaProvider({ children }: { children: ReactNode }) {
  const { estado, recarregar } = useLeituraPlataforma("/platform/access", ehAcesso);
  const valor = useMemo(() => ({ estado, recarregar }), [estado, recarregar]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAcessoPlataforma(): AcessoPlataforma {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("useAcessoPlataforma fora de AcessoPlataformaProvider");
  return valor;
}

/** Só uma resposta válida do servidor dizendo `true` confirma o acesso.
 * Carregando, falha de rede ou resposta estranha nunca mostram o item. */
export function acessoConfirmado(estado: AcessoPlataforma["estado"]): boolean {
  return estado.status === "pronto" && estado.dados.canViewEstablishments;
}
