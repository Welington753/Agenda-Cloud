// Plano criado por um teste de banco com TODOS os recursos do catálogo, como
// o Max: a conferência de recurso (commercial/commercial-gate.ts) recusa o
// que o plano não tem, e um plano sem nenhuma linha em `plan_features` não
// tem nada. Quem quer provar a recusa cria o plano sem este envelope.
// `exceto`: ids de recurso que ficam fora, como um plano real que não tem
// um recurso só de adicional (feat_estoque nunca entra em plano pela
// migration). Os ids são fixos do teste, nunca entrada de usuário.
//
// `feat_vendas` fica SEMPRE de fora (docs/plans/vendas-v1.md): vendas só
// existem pelo adicional, e um plano com VENDAS mudaria a saída manual do
// estoque (409 `USE_VENDAS`) em specs que não tratam de vendas.
export const SEMPRE_FORA_DO_PLANO = ['feat_vendas'] as const;

export function comTodosOsRecursos(insertDoPlano: string, exceto: readonly string[] = []): string {
  const fora = [...SEMPRE_FORA_DO_PLANO, ...exceto];
  const filtro = ` WHERE f.id NOT IN (${fora.map((x) => `'${x.replace(/[^a-z_]/g, '')}'`).join(', ')})`;
  return `WITH novo AS (${insertDoPlano} RETURNING id)
    INSERT INTO plan_features (id, plan_id, feature_id)
    SELECT 'pf' || substr(md5(novo.id || f.id), 1, 26), novo.id, f.id FROM novo CROSS JOIN features f${filtro}`;
}
