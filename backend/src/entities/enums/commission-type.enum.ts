// Novo nesta revisão (seção 3.1/5.1). Espelha `TipoComissao` ("percentual" |
// "fixo") de src/lib/types.ts. `PERCENTAGE`: valor 0-100 inteiro (não
// fração). `FIXED`: valor em centavos inteiro.
export enum CommissionType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
}
