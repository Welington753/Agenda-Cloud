// Regras puras de "Editar perfil e profissional" de um acesso que já existe.
// A troca nunca concede nada sozinha: o que vale depois é o que o dono
// marcou, sem o que deixa de se aplicar ao novo perfil e profissional (ver
// ajustarAoPerfil). A tela mostra o que sai e o que entra, e o dono confirma
// antes de salvar. O servidor confere tudo de novo
// (backend/src/team/team.service.ts, changeAccess).
import type { PerfilDaEquipe, PermissaoDaEquipe, VisaoDaEquipe } from "./contratos";
import { ajustarAoPerfil } from "./permissoes";

export interface EstadoDoAcesso {
  role: PerfilDaEquipe;
  professionalId: string | null;
  granted: readonly PermissaoDaEquipe[];
}

export interface EscolhaDaEdicao {
  perfil: PerfilDaEquipe;
  profissionalId: string | null;
  marcadas: readonly PermissaoDaEquipe[];
}

export interface ResultadoDaEdicao {
  /** O conjunto que vale depois de salvar. */
  valem: PermissaoDaEquipe[];
  saem: PermissaoDaEquipe[];
  entram: PermissaoDaEquipe[];
  trocaPerfil: boolean;
  trocaProfissional: boolean;
  mudou: boolean;
  /** Profissional sem profissional ligado não existe. */
  faltaProfissional: boolean;
}

export function resultadoDaEdicao(atual: EstadoDoAcesso, escolha: EscolhaDaEdicao): ResultadoDaEdicao {
  const valem = ajustarAoPerfil(escolha.marcadas, escolha.perfil, !!escolha.profissionalId);
  const saem = atual.granted.filter((p) => !valem.includes(p));
  const entram = valem.filter((p) => !atual.granted.includes(p));
  const trocaPerfil = escolha.perfil !== atual.role;
  const trocaProfissional = escolha.profissionalId !== atual.professionalId;
  return {
    valem,
    saem,
    entram,
    trocaPerfil,
    trocaProfissional,
    mudou: trocaPerfil || trocaProfissional || saem.length > 0 || entram.length > 0,
    faltaProfissional: escolha.perfil === "PROFISSIONAL" && !escolha.profissionalId,
  };
}

/** Corpo de `PUT .../members/:id/access`: o que a tela mostrava e o que fica. */
export function corpoDaEdicao(atual: EstadoDoAcesso, escolha: EscolhaDaEdicao) {
  return {
    expected: { role: atual.role, professionalId: atual.professionalId, granted: [...atual.granted] },
    role: escolha.perfil,
    professionalId: escolha.profissionalId,
    granted: resultadoDaEdicao(atual, escolha).valem,
  };
}

/** Nome de uma permissão para o resumo da confirmação. */
export function rotuloDaPermissao(visao: VisaoDaEquipe, permissao: PermissaoDaEquipe): string {
  const propria = visao.permissionLabels.find((r) => r.permission === permissao);
  if (propria) return `Próprios atendimentos: ${propria.label.toLowerCase()}`;
  const area = visao.managerPermissions?.find((c) => c.permission === permissao);
  return area ? `${area.areaLabel}: ${area.label.toLowerCase()}` : permissao;
}

export function ehAcessoEditado(
  v: unknown,
): v is { membershipId: string; role: PerfilDaEquipe; professionalId: string | null; grantedPermissions: PermissaoDaEquipe[] } {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.membershipId === "string" &&
    (o.role === "PROFISSIONAL" || o.role === "GERENTE") &&
    (o.professionalId === null || typeof o.professionalId === "string") &&
    Array.isArray(o.grantedPermissions)
  );
}
