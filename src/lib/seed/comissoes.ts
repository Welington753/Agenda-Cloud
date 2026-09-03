// Dados simulados de regras de comissão.

import { addDays } from "date-fns";
import type { RegraComissao } from "../types";
import { TENANT_DOM_NAVALHA } from "./shared";

export function gerarRegrasComissaoSeed(): RegraComissao[] {
  return [
    {
      id: "regra-comissao-joao-corte-tradicional",
      tenantId: TENANT_DOM_NAVALHA,
      profissionalId: "prof-joao-silva",
      servicoId: "serv-corte-tradicional",
      tipo: "percentual",
      valor: 40,
      criadoEm: addDays(new Date(), -30).toISOString(),
      atualizadoEm: addDays(new Date(), -30).toISOString(),
    },
  ];
}
