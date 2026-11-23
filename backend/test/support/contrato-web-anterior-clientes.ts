// CONTRATO DO WEB JÁ PUBLICADO para clientes, congelado: os validadores de
// src/lib/api/consumers-api.ts no commit 0d8f479 (API e web Live desde
// 19/11/2026). Durante a publicação do lote de clientes, a API nova fica no ar
// com este web; os testes de banco rodam estes validadores sobre as respostas
// reais da API nova. Se um campo que o web publicado exige sumir ou mudar de
// forma, o teste quebra. Não edite para "passar": a cópia só muda quando o web
// publicado mudar (troque pelo arquivo do novo commit Live e registre o SHA).
/* eslint-disable */

export interface ClienteReal {
  id: string;
  name: string;
  whatsapp: string;
  email: string | null;
}

export function ehCliente(valor: unknown): valor is ClienteReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.whatsapp === "string" &&
    (v.email === null || typeof v.email === "string")
  );
}

/** `pesquisarClientes`: corpo de `GET .../consumers?q=`. */
export function buscaAceita(data: unknown): boolean {
  const corpo = data as { consumers?: unknown };
  return Array.isArray(corpo?.consumers) && corpo.consumers.every(ehCliente);
}

/** `cadastrarCliente`: corpo de `POST .../consumers` (2xx). */
export function cadastroAceito(data: unknown): boolean {
  const corpo = data as { consumer?: unknown };
  return ehCliente(corpo?.consumer);
}

/** `listarPaginaDeClientes`: corpo de `GET .../consumers/page`. */
export function paginaAceita(data: unknown): boolean {
  const corpo = data as { consumers?: unknown; nextCursor?: unknown; total?: unknown };
  return (
    Array.isArray(corpo?.consumers) &&
    corpo.consumers.every(ehCliente) &&
    (corpo.nextCursor === null || typeof corpo.nextCursor === "string") &&
    typeof corpo.total === "number"
  );
}

/** `falhaPorStatus`: 409 é "duplicado" e a tela mostra `message`. */
export function falhaDoWebAnterior(status: number, data: unknown): { tipo: string; mensagem?: string | null } {
  const mensagem = typeof (data as { message?: unknown })?.message === "string" ? (data as { message: string }).message : null;
  if (status === 401) return { tipo: "nao_autenticado" };
  if (status === 403) return { tipo: "sem_permissao" };
  if (status === 404) return { tipo: "sem_acesso" };
  if (status === 409) return { tipo: "duplicado", mensagem };
  if (status === 400) return { tipo: "dados_invalidos", mensagem };
  return { tipo: "indisponivel" };
}
