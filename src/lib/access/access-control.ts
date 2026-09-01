// Cálculo de acesso efetivo — função pura e centralizada. NENHUM componente deve
// reimplementar esta lógica; todos consultam `calcularAcessoEfetivo` (portal do
// estabelecimento) ou `podeAdministrarPlataforma` (administração master).
//
// Por que duas funções em vez de uma só: o domínio de um administrador de
// plataforma não tem "plano" nem "tenant" — misturar os dois na mesma função
// forçaria campos opcionais sem sentido nos dois lados e esconderia a regra em
// vez de deixá-la clara. Cada uma cobre um contexto fechado.

import { obterDefinicaoPlano } from "@/lib/planos";
import type {
  CodigoPlano,
  Feature,
  PapelEstabelecimento,
  PapelPlataforma,
  Permission,
  PermissaoPlataforma,
  StatusEstabelecimento,
  StatusUsuario,
} from "@/lib/types";

/** Permissões cuja liberação depende de uma feature contratada. Uma permissão
 * ausente deste mapa nunca é bloqueada por feature (ex.: `servicos.*`,
 * `configuracoes.gerenciar` são núcleo do produto, sempre disponíveis ao papel
 * que as tem). */
export const PERMISSAO_PARA_FEATURE: Partial<Record<Permission, Feature>> = {
  "agenda.visualizar": "agenda",
  "agenda.gerenciar": "agenda",
  "agendamento.criar": "agenda",
  "agendamento.editar": "agenda",
  "agendamento.cancelar": "agenda",
  "profissionais.visualizar": "profissionais",
  "profissionais.gerenciar": "profissionais",
  "consumidores.visualizar": "consumidores",
  "consumidores.gerenciar": "consumidores",
  "relatorios.visualizar": "relatorios",
  "equipe.visualizar": "equipe",
  "equipe.gerenciar": "equipe",
};

const TODAS_AS_PERMISSOES: Permission[] = [
  "dashboard.visualizar",
  "agenda.visualizar",
  "agenda.gerenciar",
  "agendamento.criar",
  "agendamento.editar",
  "agendamento.cancelar",
  "profissionais.visualizar",
  "profissionais.gerenciar",
  "servicos.visualizar",
  "servicos.gerenciar",
  "consumidores.visualizar",
  "consumidores.gerenciar",
  "relatorios.visualizar",
  "equipe.visualizar",
  "equipe.gerenciar",
  "personalizacao.gerenciar",
  "configuracoes.gerenciar",
];

/** Perfis padrão por papel de estabelecimento — ver docs/plans/gestao-contas-permissoes.md.
 * "Dono: todos os acessos liberados pelo plano do tenant" é modelado dando ao
 * dono TODAS as permissões aqui; o plano/feature ainda restringe o que resulta
 * disso na prática (passo 3–4 do cálculo). */
export const PERMISSOES_PADRAO_POR_PAPEL: Record<PapelEstabelecimento, Permission[]> = {
  dono: TODAS_AS_PERMISSOES,
  gerente: [
    "dashboard.visualizar",
    "agenda.visualizar",
    "agenda.gerenciar",
    "agendamento.criar",
    "agendamento.editar",
    "agendamento.cancelar",
    "profissionais.visualizar",
    "profissionais.gerenciar",
    "servicos.visualizar",
    "servicos.gerenciar",
    "consumidores.visualizar",
    "consumidores.gerenciar",
    "relatorios.visualizar",
  ],
  recepcionista: [
    "dashboard.visualizar",
    "agenda.visualizar",
    "agenda.gerenciar",
    "agendamento.criar",
    "agendamento.editar",
    "agendamento.cancelar",
    "consumidores.visualizar",
    "consumidores.gerenciar",
  ],
  profissional: ["agenda.visualizar", "agenda.gerenciar", "agendamento.editar", "agendamento.cancelar"],
};

export interface EntradaAcessoEfetivo {
  permissao: Permission;
  papel: PapelEstabelecimento;
  plano: CodigoPlano;
  featuresDesativadas: Feature[];
  permissoesLiberadas: Permission[];
  permissoesNegadas: Permission[];
  usuarioStatus: StatusUsuario;
  tenantStatus: StatusEstabelecimento;
}

export interface ResultadoAcesso {
  permitido: boolean;
  /** Motivo amigável para exibir numa página 403 quando `permitido === false`. */
  motivo?: string;
}

/** Estabelecimentos "ativo" ou "teste" (período de avaliação) funcionam
 * normalmente. Só "suspenso" e "cancelado" bloqueiam o portal — um tenant em
 * teste precisa poder usar o produto, senão o teste não serve pra nada. */
const STATUS_TENANT_FUNCIONAL: StatusEstabelecimento[] = ["ativo", "teste", "inadimplente"];

/**
 * Uma permissão só é concedida quando TODAS as condições são verdadeiras, nesta
 * ordem (a ordem importa para o `motivo` retornado fazer sentido):
 *
 * 1. O tenant está em um status funcional (ativo/teste/inadimplente — não suspenso nem cancelado).
 * 2. O usuário está ativo.
 * 3. A negação individual explícita NÃO cobre esta permissão (vence tudo abaixo).
 * 4. A feature associada à permissão (se houver) está no plano do tenant.
 * 5. A feature associada NÃO foi desativada pelo master para este tenant.
 * 6. A permissão está no conjunto efetivo do papel (padrão do papel ∪ liberações individuais).
 */
export function calcularAcessoEfetivo(entrada: EntradaAcessoEfetivo): ResultadoAcesso {
  if (!STATUS_TENANT_FUNCIONAL.includes(entrada.tenantStatus)) {
    return {
      permitido: false,
      motivo:
        entrada.tenantStatus === "suspenso"
          ? "Este estabelecimento está suspenso na plataforma."
          : "Este estabelecimento está cancelado na plataforma.",
    };
  }
  if (entrada.usuarioStatus !== "ativo") {
    return { permitido: false, motivo: "Sua conta não está ativa neste estabelecimento." };
  }
  if (entrada.permissoesNegadas.includes(entrada.permissao)) {
    return { permitido: false, motivo: "Seu acesso a esta área foi restringido individualmente." };
  }

  const feature = PERMISSAO_PARA_FEATURE[entrada.permissao];
  if (feature) {
    const definicaoPlano = obterDefinicaoPlano(entrada.plano);
    if (!definicaoPlano.features.includes(feature)) {
      return { permitido: false, motivo: "Esta funcionalidade não está incluída no plano atual." };
    }
    if (entrada.featuresDesativadas.includes(feature)) {
      return { permitido: false, motivo: "Esta funcionalidade foi desativada para este estabelecimento." };
    }
  }

  const permissoesEfetivas = new Set([
    ...PERMISSOES_PADRAO_POR_PAPEL[entrada.papel],
    ...entrada.permissoesLiberadas,
  ]);
  if (!permissoesEfetivas.has(entrada.permissao)) {
    return { permitido: false, motivo: "Seu perfil não tem acesso a esta área." };
  }

  return { permitido: true };
}

/** Determina se uma feature está efetivamente ligada para um tenant (plano a
 * inclui e o master não a desativou) — usado para esconder seções inteiras de
 * UI (ex.: menu) sem precisar de uma permissão específica associada. */
export function featureHabilitada(plano: CodigoPlano, featuresDesativadas: Feature[], feature: Feature): boolean {
  return obterDefinicaoPlano(plano).features.includes(feature) && !featuresDesativadas.includes(feature);
}

// ---------------------------------------------------------------------------
// Administração de plataforma (domínio separado — ver comentário no topo)
// ---------------------------------------------------------------------------

const PERMISSOES_PADRAO_MASTER: Record<PapelPlataforma, PermissaoPlataforma[]> = {
  MASTER_OWNER: ["estabelecimentos.gerenciar", "administradores.gerenciar", "planos.gerenciar", "suporte.acessar"],
  MASTER_ADMIN: [],
  MASTER_SUPPORT: ["suporte.acessar"],
};

export function podeAdministrarPlataforma(
  papel: PapelPlataforma,
  permissoesExtras: PermissaoPlataforma[],
  status: StatusUsuario,
  permissaoRequerida: PermissaoPlataforma
): ResultadoAcesso {
  if (status !== "ativo") {
    return { permitido: false, motivo: "Sua conta de administrador não está ativa." };
  }
  if (papel === "MASTER_OWNER") return { permitido: true };
  const efetivas = new Set([...PERMISSOES_PADRAO_MASTER[papel], ...permissoesExtras]);
  if (!efetivas.has(permissaoRequerida)) {
    return { permitido: false, motivo: "Seu perfil de administrador não tem esta permissão." };
  }
  return { permitido: true };
}

/** Só MASTER_OWNER cadastra ou remove outro administrador master. */
export function podeGerenciarAdministradores(papel: PapelPlataforma): boolean {
  return papel === "MASTER_OWNER";
}

interface UsuarioPlataformaMinimo {
  id: string;
  papel: PapelPlataforma;
  criadoEm: string;
}

/** O "proprietário principal" é o MASTER_OWNER mais antigo — não é um campo
 * marcado manualmente, é derivado, então continua correto mesmo se mais
 * MASTER_OWNERs forem criados depois. Ele nunca pode ser removido, nem por
 * outro MASTER_OWNER. */
export function identificarProprietarioPrincipal<T extends UsuarioPlataformaMinimo>(usuarios: T[]): T | undefined {
  return usuarios
    .filter((u) => u.papel === "MASTER_OWNER")
    .sort((a, b) => new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime())[0];
}
