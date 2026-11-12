"use client";

// Acesso ao portal da plataforma, lido UMA vez pelo layout do portal
// (`/portal/**`): o menu do portal e o portão das páginas usam a mesma
// resposta, sem uma segunda consulta. A operação (`/conta`) não o lê.
//
// Vem só de `GET /platform/access`, que o backend calcula a partir do papel e
// das permissões de plataforma relidos do banco. Nada aqui olha e-mail, nome
// ou vínculo com estabelecimento. É só apresentação: cada leitura de dados da
// administração é autorizada de novo no servidor, e um papel revogado vira
// 403 ali mesmo que o item continue no menu até a próxima leitura.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { EVENTO_SEGUNDO_FATOR } from "@/lib/api/http-client";
import { ehAcesso, type AcessoPlataforma as Acesso } from "./contratos";
import { useLeituraPlataforma, type LeituraPlataforma } from "./use-leitura-plataforma";

interface AcessoPlataforma {
  estado: LeituraPlataforma<Acesso>;
  recarregar: () => void;
}

const Contexto = createContext<AcessoPlataforma | null>(null);

export function AcessoPlataformaProvider({ children }: { children: ReactNode }) {
  const { estado, recarregar } = useLeituraPlataforma("/platform/access", ehAcesso);
  // Uma rota do portal pediu o segundo fator (verificação vencida no meio do
  // uso): relê o acesso, e o portão troca a página pela etapa do código.
  useEffect(() => {
    window.addEventListener(EVENTO_SEGUNDO_FATOR, recarregar);
    return () => window.removeEventListener(EVENTO_SEGUNDO_FATOR, recarregar);
  }, [recarregar]);
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

/** Capacidades confirmadas pelo servidor; sem resposta válida, nenhuma. */
export function capacidadesConfirmadas(estado: AcessoPlataforma["estado"]) {
  if (estado.status !== "pronto") return { viewDirectory: false, manageEstablishments: false, managePlatformAccess: false };
  return (
    estado.dados.capabilities ?? {
      viewDirectory: estado.dados.canViewEstablishments,
      manageEstablishments: false,
      managePlatformAccess: false,
    }
  );
}

export function useCapacidades() {
  return capacidadesConfirmadas(useAcessoPlataforma().estado);
}
