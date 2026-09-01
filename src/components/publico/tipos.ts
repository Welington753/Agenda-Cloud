// Contrato comum dos modelos de página pública. Os dois modelos (clássico e
// moderno) recebem exatamente os mesmos dados — nenhum código é escrito por
// estabelecimento, só a apresentação muda entre os arquivos `modelo-*.tsx`.

import type { Terminologia } from "@/lib/verticals/terminologia";
import type { Estabelecimento, Profissional, Servico } from "@/lib/types";

export interface ModeloPaginaPublicaProps {
  slug: string;
  estabelecimento: Estabelecimento;
  profissionais: Profissional[];
  servicos: Servico[];
  terminologia: Terminologia;
  agendamentoPublicoHabilitado: boolean;
}
