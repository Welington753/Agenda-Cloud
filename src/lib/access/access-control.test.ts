import { describe, expect, it } from "vitest";
import {
  calcularAcessoEfetivo,
  featureHabilitada,
  identificarProprietarioPrincipal,
  podeAdministrarPlataforma,
  podeAlterarPapelAdministrador,
  podeAlterarStatusAdministrador,
  podeCriarAdministrador,
  podeGerenciarAdministradores,
  podeReceberAgendamentoPublico,
  podeRemoverAdministrador,
} from "./access-control";
import type { EntradaAcessoEfetivo } from "./access-control";
import type { PapelPlataforma, StatusUsuario } from "@/lib/types";

function baseEntrada(overrides: Partial<EntradaAcessoEfetivo> = {}): EntradaAcessoEfetivo {
  return {
    permissao: "relatorios.visualizar",
    papel: "gerente",
    plano: "equipe",
    featuresDesativadas: [],
    permissoesLiberadas: [],
    permissoesNegadas: [],
    usuarioStatus: "ativo",
    tenantStatus: "ativo",
    ...overrides,
  };
}

describe("calcularAcessoEfetivo", () => {
  it("permite quando plano, feature, papel e status estão todos ok", () => {
    expect(calcularAcessoEfetivo(baseEntrada()).permitido).toBe(true);
  });

  it("bloqueia quando o plano não inclui a feature associada à permissão", () => {
    const resultado = calcularAcessoEfetivo(baseEntrada({ plano: "essencial" }));
    expect(resultado.permitido).toBe(false);
    expect(resultado.motivo).toMatch(/plano/i);
  });

  it("bloqueia quando o master desativou a feature mesmo com o plano incluindo", () => {
    const resultado = calcularAcessoEfetivo(baseEntrada({ featuresDesativadas: ["relatorios"] }));
    expect(resultado.permitido).toBe(false);
    expect(resultado.motivo).toMatch(/desativada/i);
  });

  it("negação individual explícita vence a permissão liberada pelo papel", () => {
    const resultado = calcularAcessoEfetivo(
      baseEntrada({ papel: "dono", plano: "pro", permissoesNegadas: ["relatorios.visualizar"] })
    );
    expect(resultado.permitido).toBe(false);
    expect(resultado.motivo).toMatch(/restringido/i);
  });

  it("permissoesLiberadas concede algo fora do padrão do papel", () => {
    // Recepcionista não tem relatorios.visualizar por padrão.
    const semLiberacao = calcularAcessoEfetivo(baseEntrada({ papel: "recepcionista" }));
    expect(semLiberacao.permitido).toBe(false);

    const comLiberacao = calcularAcessoEfetivo(
      baseEntrada({ papel: "recepcionista", permissoesLiberadas: ["relatorios.visualizar"] })
    );
    expect(comLiberacao.permitido).toBe(true);
  });

  it("usuário suspenso é bloqueado independentemente de papel e plano", () => {
    const resultado = calcularAcessoEfetivo(baseEntrada({ papel: "dono", plano: "pro", usuarioStatus: "suspenso" }));
    expect(resultado.permitido).toBe(false);
    expect(resultado.motivo).toMatch(/conta/i);
  });

  it("tenant suspenso bloqueia qualquer permissão, mesmo dashboard.visualizar", () => {
    const resultado = calcularAcessoEfetivo(
      baseEntrada({ permissao: "dashboard.visualizar", papel: "dono", plano: "pro", tenantStatus: "suspenso" })
    );
    expect(resultado.permitido).toBe(false);
    expect(resultado.motivo).toMatch(/suspenso/i);
  });

  it("recepcionista não acessa relatórios mesmo no plano pro (permissão não é do papel)", () => {
    const resultado = calcularAcessoEfetivo(
      baseEntrada({ papel: "recepcionista", plano: "pro", permissao: "relatorios.visualizar" })
    );
    expect(resultado.permitido).toBe(false);
  });

  it("recepcionista não gerencia personalização mesmo no plano pro", () => {
    const resultado = calcularAcessoEfetivo(
      baseEntrada({ papel: "recepcionista", plano: "pro", permissao: "personalizacao.gerenciar" })
    );
    expect(resultado.permitido).toBe(false);
  });

  it("recepcionista não gerencia configurações mesmo no plano pro", () => {
    const resultado = calcularAcessoEfetivo(
      baseEntrada({ papel: "recepcionista", plano: "pro", permissao: "configuracoes.gerenciar" })
    );
    expect(resultado.permitido).toBe(false);
  });

  it("permissões sem feature associada (ex.: servicos.gerenciar) não dependem do plano", () => {
    const resultado = calcularAcessoEfetivo(
      baseEntrada({ papel: "gerente", plano: "essencial", permissao: "servicos.gerenciar" })
    );
    expect(resultado.permitido).toBe(true);
  });
});

describe("featureHabilitada", () => {
  it("reflete plano e exceções sem depender de papel/usuário", () => {
    expect(featureHabilitada("equipe", [], "relatorios")).toBe(true);
    expect(featureHabilitada("essencial", [], "relatorios")).toBe(false);
    expect(featureHabilitada("equipe", ["relatorios"], "relatorios")).toBe(false);
  });
});

describe("podeAdministrarPlataforma", () => {
  it("MASTER_OWNER tem acesso total mesmo sem permissoesExtras", () => {
    expect(podeAdministrarPlataforma("MASTER_OWNER", [], "ativo", "administradores.gerenciar").permitido).toBe(true);
  });

  it("MASTER_SUPPORT sem permissão extra não administra estabelecimentos", () => {
    const resultado = podeAdministrarPlataforma("MASTER_SUPPORT", [], "ativo", "estabelecimentos.gerenciar");
    expect(resultado.permitido).toBe(false);
  });

  it("MASTER_ADMIN só tem o que estiver em permissoesExtras", () => {
    expect(podeAdministrarPlataforma("MASTER_ADMIN", [], "ativo", "planos.gerenciar").permitido).toBe(false);
    expect(
      podeAdministrarPlataforma("MASTER_ADMIN", ["planos.gerenciar"], "ativo", "planos.gerenciar").permitido
    ).toBe(true);
  });

  it("administrador suspenso é sempre bloqueado, mesmo MASTER_OWNER", () => {
    expect(podeAdministrarPlataforma("MASTER_OWNER", [], "suspenso", "suporte.acessar").permitido).toBe(false);
  });
});

describe("podeGerenciarAdministradores", () => {
  it("apenas MASTER_OWNER pode cadastrar ou remover outro administrador master", () => {
    expect(podeGerenciarAdministradores("MASTER_OWNER")).toBe(true);
    expect(podeGerenciarAdministradores("MASTER_ADMIN")).toBe(false);
    expect(podeGerenciarAdministradores("MASTER_SUPPORT")).toBe(false);
  });
});

describe("permissões de comissões", () => {
  it("dono no plano pro vê e gerencia comissões", () => {
    expect(calcularAcessoEfetivo(baseEntrada({ permissao: "comissoes.visualizar", papel: "dono", plano: "pro" })).permitido).toBe(true);
    expect(calcularAcessoEfetivo(baseEntrada({ permissao: "comissoes.gerenciar", papel: "dono", plano: "pro" })).permitido).toBe(true);
  });

  it("recepcionista não gerencia comissões mesmo no plano pro", () => {
    const resultado = calcularAcessoEfetivo(baseEntrada({ permissao: "comissoes.gerenciar", papel: "recepcionista", plano: "pro" }));
    expect(resultado.permitido).toBe(false);
  });

  it("plano sem a feature comissoes bloqueia acesso mesmo para o dono", () => {
    const resultado = calcularAcessoEfetivo(baseEntrada({ permissao: "comissoes.visualizar", papel: "dono", plano: "equipe" }));
    expect(resultado.permitido).toBe(false);
    expect(resultado.motivo).toMatch(/plano/i);
  });
});

describe("podeReceberAgendamentoPublico", () => {
  it("permite quando o tenant está ativo", () => {
    expect(podeReceberAgendamentoPublico("ativo")).toBe(true);
  });
  it("permite quando o tenant está em teste", () => {
    expect(podeReceberAgendamentoPublico("teste")).toBe(true);
  });
  it("permite quando o tenant está inadimplente (regra funcional atual)", () => {
    expect(podeReceberAgendamentoPublico("inadimplente")).toBe(true);
  });
  it("bloqueia quando o tenant está suspenso", () => {
    expect(podeReceberAgendamentoPublico("suspenso")).toBe(false);
  });
  it("bloqueia quando o tenant está cancelado", () => {
    expect(podeReceberAgendamentoPublico("cancelado")).toBe(false);
  });
});

describe("identificarProprietarioPrincipal", () => {
  it("é o MASTER_OWNER mais antigo, mesmo com outros MASTER_OWNERs cadastrados depois", () => {
    const usuarios = [
      { id: "mais-novo", papel: "MASTER_OWNER" as const, criadoEm: "2024-06-01T00:00:00.000Z" },
      { id: "mais-antigo", papel: "MASTER_OWNER" as const, criadoEm: "2020-01-01T00:00:00.000Z" },
      { id: "admin", papel: "MASTER_ADMIN" as const, criadoEm: "2019-01-01T00:00:00.000Z" },
    ];
    expect(identificarProprietarioPrincipal(usuarios)?.id).toBe("mais-antigo");
  });

  it("o proprietário principal nunca deve ser removível — a tela precisa comparar o id contra este resultado", () => {
    const usuarios = [{ id: "unico-owner", papel: "MASTER_OWNER" as const, criadoEm: "2020-01-01T00:00:00.000Z" }];
    const principal = identificarProprietarioPrincipal(usuarios);
    expect(principal?.id).toBe("unico-owner");
    // A regra de negócio em si (bloquear a remoção) vive na tela/repositório —
    // aqui garantimos que a função de identificação é determinística e estável.
    expect(identificarProprietarioPrincipal(usuarios)?.id).toBe(principal?.id);
  });
});

interface UsuarioTeste {
  id: string;
  papel: PapelPlataforma;
  status: StatusUsuario;
}

function owner(id: string, status: StatusUsuario = "ativo"): UsuarioTeste {
  return { id, papel: "MASTER_OWNER", status };
}

describe("regras dos dois MASTER_OWNER", () => {
  describe("podeCriarAdministrador", () => {
    it("owner autorizado pode criar um segundo MASTER_OWNER", () => {
      expect(podeCriarAdministrador("MASTER_OWNER", "MASTER_OWNER").permitido).toBe(true);
    });

    it("MASTER_SUPPORT sem permissão não cria nenhum administrador", () => {
      expect(podeCriarAdministrador("MASTER_SUPPORT", "MASTER_SUPPORT").permitido).toBe(false);
    });

    it("MASTER_ADMIN não promove ninguém a MASTER_OWNER, mesmo administrando", () => {
      // Hoje podeGerenciarAdministradores já bloqueia MASTER_ADMIN por completo;
      // este teste prova a segunda camada (nunca promover a owner) de forma
      // explícita, independente da primeira mudar no futuro.
      expect(podeCriarAdministrador("MASTER_ADMIN", "MASTER_OWNER").permitido).toBe(false);
    });

    it("papéis de estabelecimento nunca são reconhecidos como gerenciadores de administradores da plataforma", () => {
      // Checagem em tempo de execução, não só de tipos: mesmo que algum código
      // futuro passe um papel de tenant aqui por engano, a função nunca libera.
      expect(podeGerenciarAdministradores("dono" as PapelPlataforma)).toBe(false);
      expect(podeGerenciarAdministradores("gerente" as PapelPlataforma)).toBe(false);
      expect(podeCriarAdministrador("dono" as PapelPlataforma, "MASTER_SUPPORT").permitido).toBe(false);
      expect(podeCriarAdministrador("gerente" as PapelPlataforma, "MASTER_SUPPORT").permitido).toBe(false);
    });
  });

  describe("podeAlterarStatusAdministrador", () => {
    it("último MASTER_OWNER ativo não pode ser desativado", () => {
      const usuarios = [owner("unico")];
      const resultado = podeAlterarStatusAdministrador(usuarios, "MASTER_OWNER", "unico", "suspenso");
      expect(resultado.permitido).toBe(false);
    });

    it("com dois owners ativos, um pode ser desativado se o outro continuar ativo", () => {
      const usuarios = [owner("a"), owner("b")];
      const resultado = podeAlterarStatusAdministrador(usuarios, "MASTER_OWNER", "a", "suspenso");
      expect(resultado.permitido).toBe(true);
    });

    it("usuário sem permissão de gerenciar administradores não altera status de ninguém", () => {
      const usuarios = [owner("a"), owner("b")];
      const resultado = podeAlterarStatusAdministrador(usuarios, "MASTER_SUPPORT", "a", "suspenso");
      expect(resultado.permitido).toBe(false);
    });

    it("reativar um owner suspenso nunca é bloqueado pela regra de zero owners", () => {
      const usuarios = [owner("unico", "suspenso")];
      const resultado = podeAlterarStatusAdministrador(usuarios, "MASTER_OWNER", "unico", "ativo");
      expect(resultado.permitido).toBe(true);
    });
  });

  describe("podeAlterarPapelAdministrador", () => {
    it("último MASTER_OWNER ativo não pode ser rebaixado", () => {
      const usuarios = [owner("unico")];
      const resultado = podeAlterarPapelAdministrador(usuarios, "MASTER_OWNER", "unico", "MASTER_ADMIN");
      expect(resultado.permitido).toBe(false);
    });

    it("com dois owners ativos, rebaixar um é permitido se o outro continuar owner ativo", () => {
      const usuarios = [owner("a"), owner("b")];
      const resultado = podeAlterarPapelAdministrador(usuarios, "MASTER_OWNER", "a", "MASTER_ADMIN");
      expect(resultado.permitido).toBe(true);
    });

    it("usuário sem permissão de gerenciar administradores não altera papel de ninguém", () => {
      const usuarios = [owner("a"), owner("b")];
      const resultado = podeAlterarPapelAdministrador(usuarios, "MASTER_SUPPORT", "a", "MASTER_ADMIN");
      expect(resultado.permitido).toBe(false);
    });

    it("MASTER_ADMIN não promove outra conta a MASTER_OWNER via troca de papel", () => {
      const usuarios = [owner("a"), { id: "b", papel: "MASTER_ADMIN" as const, status: "ativo" as const }];
      const resultado = podeAlterarPapelAdministrador(usuarios, "MASTER_ADMIN", "b", "MASTER_OWNER");
      expect(resultado.permitido).toBe(false);
    });
  });

  describe("podeRemoverAdministrador", () => {
    it("último MASTER_OWNER ativo não pode ser removido", () => {
      const usuarios = [owner("unico")];
      const resultado = podeRemoverAdministrador(usuarios, "MASTER_OWNER", "unico");
      expect(resultado.permitido).toBe(false);
    });

    it("com dois owners ativos, remover um é permitido se o outro continuar ativo", () => {
      const usuarios = [owner("a"), owner("b")];
      const resultado = podeRemoverAdministrador(usuarios, "MASTER_OWNER", "a");
      expect(resultado.permitido).toBe(true);
    });

    it("usuário sem permissão de gerenciar administradores não remove ninguém", () => {
      const usuarios = [owner("a"), owner("b")];
      const resultado = podeRemoverAdministrador(usuarios, "MASTER_ADMIN", "a");
      expect(resultado.permitido).toBe(false);
    });
  });
});
