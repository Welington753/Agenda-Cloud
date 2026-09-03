// Novo nesta revisão (seção 3.1/5.2). Espelha `StatusLancamentoComissao`
// ("confirmado" | "estornado") de src/lib/types.ts. `CONFIRMED`: lançamento
// válido, entra nos totais do relatório. `REVERSED`: o agendamento que o
// gerou foi revertido depois de concluído — o registro nunca é apagado, só
// marcado, e pode voltar a `CONFIRMED` se o mesmo agendamento for concluído
// de novo (reativação sem recalcular a regra, ver seção 5.2).
export enum CommissionEntryStatus {
  CONFIRMED = 'CONFIRMED',
  REVERSED = 'REVERSED',
}
