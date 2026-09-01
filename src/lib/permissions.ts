// Rota inicial por papel, usada pela tela de login para redirecionar depois da
// autenticação simulada. As checagens de acesso em si vivem em
// `src/lib/access/access-control.ts` (portal do estabelecimento) e nos
// componentes `RequireRole`/`RequirePermission`.

import type { PapelEstabelecimento, PapelPlataforma } from "./types";

export const ROTA_INICIAL_POR_PAPEL_PLATAFORMA: Record<PapelPlataforma, string> = {
  MASTER_OWNER: "/master",
  MASTER_ADMIN: "/master",
  MASTER_SUPPORT: "/master",
};

export const ROTA_INICIAL_POR_PAPEL_ESTABELECIMENTO: Record<PapelEstabelecimento, string> = {
  dono: "/painel",
  gerente: "/painel",
  recepcionista: "/painel",
  profissional: "/profissional/agenda",
};
