// Plano criado por um teste de banco com TODOS os recursos do catálogo, como
// o Max: a conferência de recurso (commercial/commercial-gate.ts) recusa o
// que o plano não tem, e um plano sem nenhuma linha em `plan_features` não
// tem nada. Quem quer provar a recusa cria o plano sem este envelope.
export function comTodosOsRecursos(insertDoPlano: string): string {
  return `WITH novo AS (${insertDoPlano} RETURNING id)
    INSERT INTO plan_features (id, plan_id, feature_id)
    SELECT 'pf' || substr(md5(novo.id || f.id), 1, 26), novo.id, f.id FROM novo CROSS JOIN features f`;
}
