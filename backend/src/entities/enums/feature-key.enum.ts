// Os 13 valores do enum `FeatureKey` do schema.prisma original (espelhando
// `Feature` em src/lib/types.ts) e `ESTOQUE`, acrescentado ao tipo
// `feature_key` pela migration StockEnumValues1794009600000 (adicional de
// estoque, docs/plans/estoque-v1.md) e `VENDAS` (migration
// SalesEnumValues1794528000000, docs/plans/vendas-v1.md).
export enum FeatureKey {
  AGENDA = 'AGENDA',
  AGENDAMENTO_PUBLICO = 'AGENDAMENTO_PUBLICO',
  PROFISSIONAIS = 'PROFISSIONAIS',
  CONSUMIDORES = 'CONSUMIDORES',
  RELATORIOS = 'RELATORIOS',
  EQUIPE = 'EQUIPE',
  PERSONALIZACAO_AVANCADA = 'PERSONALIZACAO_AVANCADA',
  MULTIPLAS_UNIDADES = 'MULTIPLAS_UNIDADES',
  DOMINIO_PROPRIO = 'DOMINIO_PROPRIO',
  LISTA_DE_ESPERA = 'LISTA_DE_ESPERA',
  COMISSOES = 'COMISSOES',
  PAGAMENTOS = 'PAGAMENTOS',
  ASSINATURAS = 'ASSINATURAS',
  ESTOQUE = 'ESTOQUE',
  VENDAS = 'VENDAS',
}
