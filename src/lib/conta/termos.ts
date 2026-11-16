// Termo do segmento na área REAL. O servidor informa o segmento do
// estabelecimento ativo no contexto da sessão (`tenantCategory`, o enum
// `BusinessCategory` do backend); aqui ele vira o nome de quem atende.
//
// Regra pura, sem dados da demonstração: a terminologia de
// `src/lib/verticals` pertence à demonstração e não entra na área real.
// Hoje só a barbearia tem termo próprio; qualquer outro segmento, ou uma API
// anterior que não informa o segmento, fica com "Profissionais".

const PROFISSIONAIS_POR_SEGMENTO: Record<string, string> = {
  BARBERSHOP: "Barbeiros",
};

export const ROTULO_PROFISSIONAIS_PADRAO = "Profissionais";

/** Nome, no plural, de quem atende neste segmento. */
export function rotuloDosProfissionais(segmento: string | null | undefined): string {
  return (segmento && PROFISSIONAIS_POR_SEGMENTO[segmento]) || ROTULO_PROFISSIONAIS_PADRAO;
}
