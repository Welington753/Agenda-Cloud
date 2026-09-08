// Itens do checklist de "primeiros passos", mostrado no painel logo após o
// onboarding demonstrável concluir. Dados puros e testáveis — a leitura de
// "dispensado" e o link/slug de cada ação ficam no componente
// (`src/components/painel/checklist-primeiros-passos.tsx`), que é quem sabe o
// tenant e o slug atuais.

export type TipoAcaoChecklist = "rota" | "copiar-link" | "rota-publica";

export interface ItemChecklist {
  id: string;
  titulo: string;
  tipo: TipoAcaoChecklist;
  /** Só presente quando `tipo === "rota"` — uma rota fixa do painel. */
  rotaDestino?: string;
}

export const CHECKLIST_PRIMEIROS_PASSOS: ItemChecklist[] = [
  { id: "profissional", titulo: "Cadastrar primeiro profissional", tipo: "rota", rotaDestino: "/painel/profissionais" },
  { id: "servico", titulo: "Cadastrar primeiro serviço", tipo: "rota", rotaDestino: "/painel/servicos" },
  { id: "horarios", titulo: "Configurar horários de funcionamento", tipo: "rota", rotaDestino: "/painel/configuracoes" },
  { id: "personalizacao", titulo: "Personalizar página pública", tipo: "rota", rotaDestino: "/painel/personalizacao" },
  { id: "copiar-link", titulo: "Copiar link de agendamento", tipo: "copiar-link" },
  { id: "agendamento-teste", titulo: "Realizar um agendamento de teste", tipo: "rota-publica" },
];
