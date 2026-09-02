import { beforeEach, describe, expect, it, vi } from "vitest";
import { usuarioPlataformaRepository } from "./index";
import { podeAlterarStatusAdministrador, podeCriarAdministrador, podeRemoverAdministrador } from "@/lib/access/access-control";
import type { PapelPlataforma } from "@/lib/types";

function criarLocalStorageFake() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => (dados.has(chave) ? (dados.get(chave) as string) : null),
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: criarLocalStorageFake() });
});

describe("compatibilidade com dados existentes", () => {
  it("o MASTER_OWNER semeado (mstr-ana-beatriz) continua carregando normalmente", () => {
    const todos = usuarioPlataformaRepository.listarTodos();
    const ana = todos.find((u) => u.id === "mstr-ana-beatriz");
    expect(ana).toBeDefined();
    expect(ana?.papel).toBe("MASTER_OWNER");
    expect(ana?.status).toBe("ativo");
  });

  it("ler a coleção de usuários de plataforma duas vezes não duplica contas (seed idempotente)", () => {
    const primeira = usuarioPlataformaRepository.listarTodos().length;
    const segunda = usuarioPlataformaRepository.listarTodos().length;
    expect(segunda).toBe(primeira);
  });
});

describe("dois MASTER_OWNER coexistindo (fluxo do segundo perfil demonstrativo)", () => {
  it("criar um segundo MASTER_OWNER não remove nem altera o primeiro, e os dois passam a coexistir ativos", () => {
    const antes = usuarioPlataformaRepository.listarTodos();
    const primeiroOwner = antes.find((u) => u.papel === "MASTER_OWNER")!;

    const verificacao = podeCriarAdministrador(primeiroOwner.papel, "MASTER_OWNER");
    expect(verificacao.permitido).toBe(true);

    const segundoOwner = usuarioPlataformaRepository.criar({
      nome: "Segundo Sócio (demonstração)",
      email: "socio2@demonstracao.local",
      papel: "MASTER_OWNER",
      status: "ativo",
      permissoesExtras: [],
      criadoEm: new Date().toISOString(),
    });

    const depois = usuarioPlataformaRepository.listarTodos();
    const owners = depois.filter((u) => u.papel === "MASTER_OWNER" && u.status === "ativo");
    expect(owners).toHaveLength(2);
    expect(depois.find((u) => u.id === primeiroOwner.id)?.status).toBe("ativo");
    expect(depois.find((u) => u.id === segundoOwner.id)?.status).toBe("ativo");
  });

  it("com dois owners ativos, desativar um é permitido e o outro continua acessando normalmente", () => {
    const segundoOwner = usuarioPlataformaRepository.criar({
      nome: "Segundo Sócio (demonstração)",
      email: "socio2@demonstracao.local",
      papel: "MASTER_OWNER",
      status: "ativo",
      permissoesExtras: [],
      criadoEm: new Date().toISOString(),
    });
    const todosAntes = usuarioPlataformaRepository.listarTodos();
    const primeiroOwner = todosAntes.find((u) => u.papel === "MASTER_OWNER" && u.id !== segundoOwner.id)!;

    const verificacao = podeAlterarStatusAdministrador(todosAntes, primeiroOwner.papel, segundoOwner.id, "suspenso");
    expect(verificacao.permitido).toBe(true);

    usuarioPlataformaRepository.atualizar(segundoOwner.id, { status: "suspenso" });
    const depois = usuarioPlataformaRepository.listarTodos();
    expect(depois.find((u) => u.id === segundoOwner.id)?.status).toBe("suspenso");
    expect(depois.find((u) => u.id === primeiroOwner.id)?.status).toBe("ativo");
  });

  it("nenhuma mutação ocorre quando a autorização falha — o último owner ativo permanece intacto", () => {
    const antes = usuarioPlataformaRepository.listarTodos();
    const unicoOwner = antes.find((u) => u.papel === "MASTER_OWNER")!;

    const verificacao = podeRemoverAdministrador(antes, unicoOwner.papel, unicoOwner.id);
    expect(verificacao.permitido).toBe(false);

    // A tela só chama `usuarioPlataformaRepository.remover` quando `permitido` é
    // verdadeiro — como não é, nenhuma chamada de mutação acontece aqui, e o
    // registro precisa continuar exatamente como estava.
    const depois = usuarioPlataformaRepository.listarTodos();
    expect(depois.find((u) => u.id === unicoOwner.id)).toBeDefined();
    expect(depois).toHaveLength(antes.length);
  });

  it("usuário sem permissão (MASTER_SUPPORT) não altera status de administrador — nenhuma mutação ocorre", () => {
    const antes = usuarioPlataformaRepository.listarTodos();
    const alvo = antes.find((u) => u.papel === "MASTER_OWNER")!;
    const statusAntes = alvo.status;

    const verificacao = podeAlterarStatusAdministrador(antes, "MASTER_SUPPORT" as PapelPlataforma, alvo.id, "suspenso");
    expect(verificacao.permitido).toBe(false);

    const depois = usuarioPlataformaRepository.listarTodos().find((u) => u.id === alvo.id);
    expect(depois?.status).toBe(statusAntes);
  });
});
