// Plano criado por um teste de banco com TODOS os recursos do catálogo, como
// o Max: a conferência de recurso (commercial/commercial-gate.ts) recusa o
// que o plano não tem, e um plano sem nenhuma linha em `plan_features` não
// tem nada. Quem quer provar a recusa cria o plano sem este envelope.
// `exceto`: ids de recurso que ficam fora, como um plano real que não tem
// um recurso só de adicional (feat_estoque nunca entra em plano pela
// migration). Os ids são fixos do teste, nunca entrada de usuário.
export function comTodosOsRecursos(insertDoPlano: string, exceto: readonly string[] = []): string {
  const filtro = exceto.length > 0 ? ` WHERE f.id NOT IN (${exceto.map((x) => `'${x.replace(/[^a-z_]/g, '')}'`).join(', ')})` : '';
  return `WITH novo AS (${insertDoPlano} RETURNING id)
    INSERT INTO plan_features (id, plan_id, feature_id)
    SELECT 'pf' || substr(md5(novo.id || f.id), 1, 26), novo.id, f.id FROM novo CROSS JOIN features f${filtro}`;
}
