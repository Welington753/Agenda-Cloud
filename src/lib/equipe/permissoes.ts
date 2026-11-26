// Regras puras da escolha de permissões em "Equipe e acessos", para o dono
// ver e confirmar EXATAMENTE o que concede. O servidor confere tudo de novo
// (backend/src/team/team-permissions.ts) e recusa um conjunto que não feche.
//
// - Marcar uma área traz junto as dependências dela (criar reserva traz ver a
//   agenda, profissionais, serviços e clientes), sempre visíveis na tela.
// - Desmarcar uma área tira junto o que dependia dela.
// - As três ações sobre os próprios atendimentos e a consulta das próprias
//   comissões valem só com profissional ligado; as áreas do estabelecimento,
//   todas no perfil Gerente.
// - Recepcionista: só registrar vendas, receber as próprias vendas e alterar
//   o preço numa venda nova, cada uma marcada em separado. Nunca estoque,
//   agenda, clientes ou consulta geral de vendas (o servidor recusa).
import type {
  PerfilDaEquipe,
  PermissaoDaEquipe,
  PermissaoDeGerenteNoCatalogo,
  PermissaoFuncionario,
  PermissaoGerente,
  VisaoDaEquipe,
} from "./contratos";

/** O que o perfil Recepcionista pode receber (RECEPTIONIST_PERMISSIONS da
 * API). A lista que vale é a do servidor, quando vem na visão. */
export const PERMISSOES_DA_RECEPCIONISTA: readonly PermissaoGerente[] = ["VENDAS_REGISTRAR", "VENDAS_RECEBER", "VENDAS_ALTERAR_PRECO"];

/** A API oferece o perfil Recepcionista (versão com vendas). */
export function ofereceRecepcionista(visao: Pick<VisaoDaEquipe, "receptionistPermissions">): boolean {
  return Array.isArray(visao.receptionistPermissions);
}

/** As áreas do catálogo que o perfil pode receber, na ordem do servidor. */
export function catalogoDoPerfil(
  visao: Pick<VisaoDaEquipe, "managerPermissions" | "receptionistPermissions">,
  perfil: PerfilDaEquipe,
): PermissaoDeGerenteNoCatalogo[] {
  const catalogo = visao.managerPermissions ?? [];
  if (perfil === "GERENTE") return catalogo;
  if (perfil === "RECEPCIONISTA") {
    const lista: readonly string[] = visao.receptionistPermissions ?? PERMISSOES_DA_RECEPCIONISTA;
    return catalogo.filter((c) => lista.includes(c.permission));
  }
  return [];
}

export const PERMISSOES_PROPRIAS: readonly PermissaoFuncionario[] = [
  "ATENDIMENTO_PROPRIO_INICIAR",
  "ATENDIMENTO_PROPRIO_CONCLUIR",
  "ATENDIMENTO_PROPRIO_FALTA",
  "COMISSOES_PROPRIAS_VISUALIZAR",
];

export function ehPermissaoPropria(p: string): p is PermissaoFuncionario {
  return (PERMISSOES_PROPRIAS as readonly string[]).includes(p);
}

/** Marca ou desmarca uma área do gerente, com as dependências. */
export function alternarArea(
  catalogo: readonly PermissaoDeGerenteNoCatalogo[],
  marcadas: readonly PermissaoDaEquipe[],
  permissao: PermissaoGerente,
  marcar: boolean,
): PermissaoDaEquipe[] {
  const conjunto = new Set<PermissaoDaEquipe>(marcadas);
  if (marcar) {
    conjunto.add(permissao);
    for (const r of catalogo.find((c) => c.permission === permissao)?.requires ?? []) conjunto.add(r);
  } else {
    conjunto.delete(permissao);
    // Tira o que depende dela, em cadeia.
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (const c of catalogo) {
        if (conjunto.has(c.permission) && c.requires.some((r) => !conjunto.has(r))) {
          conjunto.delete(c.permission);
          mudou = true;
        }
      }
    }
  }
  return ordenar(catalogo, [...conjunto]);
}

/** Quem exige esta área (para explicar por que ela não pode sair sozinha). */
export function exigidaPor(
  catalogo: readonly PermissaoDeGerenteNoCatalogo[],
  marcadas: readonly PermissaoDaEquipe[],
  permissao: PermissaoGerente,
): PermissaoDeGerenteNoCatalogo[] {
  return catalogo.filter((c) => marcadas.includes(c.permission) && c.requires.includes(permissao));
}

/** O que vale para o perfil e o profissional escolhidos (o resto sai). */
export function ajustarAoPerfil(
  marcadas: readonly PermissaoDaEquipe[],
  perfil: PerfilDaEquipe,
  comProfissional: boolean,
): PermissaoDaEquipe[] {
  return marcadas.filter((p) =>
    ehPermissaoPropria(p)
      ? comProfissional && perfil !== "RECEPCIONISTA"
      : perfil === "GERENTE" || (perfil === "RECEPCIONISTA" && (PERMISSOES_DA_RECEPCIONISTA as readonly string[]).includes(p)),
  );
}

/** Catálogo agrupado por área, na ordem do servidor. */
export function areasDoCatalogo(
  catalogo: readonly PermissaoDeGerenteNoCatalogo[],
): { area: string; rotulo: string; itens: PermissaoDeGerenteNoCatalogo[] }[] {
  const grupos: { area: string; rotulo: string; itens: PermissaoDeGerenteNoCatalogo[] }[] = [];
  for (const c of catalogo) {
    const grupo = grupos.find((g) => g.area === c.area);
    if (grupo) grupo.itens.push(c);
    else grupos.push({ area: c.area, rotulo: c.areaLabel, itens: [c] });
  }
  return grupos;
}

/** Linhas do resumo "o que será concedido", na ordem da tela. */
export function resumoDasPermissoes(
  catalogo: readonly PermissaoDeGerenteNoCatalogo[],
  rotulosProprios: readonly { permission: string; label: string }[],
  marcadas: readonly PermissaoDaEquipe[],
): string[] {
  const linhas: string[] = [];
  for (const grupo of areasDoCatalogo(catalogo)) {
    const itens = grupo.itens.filter((c) => marcadas.includes(c.permission)).map((c) => c.label.toLowerCase());
    if (itens.length) linhas.push(`${grupo.rotulo}: ${itens.join("; ")}`);
  }
  const proprias = rotulosProprios.filter((r) => marcadas.includes(r.permission as PermissaoDaEquipe)).map((r) => r.label.toLowerCase());
  if (proprias.length) linhas.push(`Próprios atendimentos: ${proprias.join("; ")}`);
  return linhas;
}

function ordenar(catalogo: readonly PermissaoDeGerenteNoCatalogo[], lista: PermissaoDaEquipe[]): PermissaoDaEquipe[] {
  const ordem = [...PERMISSOES_PROPRIAS, ...catalogo.map((c) => c.permission)] as string[];
  return lista.sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
}

export function mesmasPermissoes(a: readonly string[], b: readonly string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}
