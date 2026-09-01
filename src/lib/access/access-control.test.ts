import { describe, expect, it } from "vitest";
import {
  calcularAcessoEfetivo,
  featureHabilitada,
  identificarProprietarioPrincipal,
  podeAdministrarPlataforma,
  podeGerenciarAdministradores,
  podeReceberAgendamentoPublico,
} from "./access-control";
import type { EntradaAcessoEfetivo } from "./access-control";

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
