// Ambiente fictício e seguro só para os testes E2E — nunca lido de `.env`
// real, nunca aponta para um host real. Necessário porque `AppModule` importa
// `AppConfigModule`, que valida DATABASE_URL/DIRECT_URL na inicialização (a
// mesma regra de produção, nunca enfraquecida aqui). Como `setupFiles` do
// Vitest executa antes do arquivo de teste (e de qualquer import estático que
// ele faça, incluindo `AppModule`/`AppConfigModule`), a validação sempre vê um
// ambiente válido — nenhum DataSource é criado nem nenhuma conexão de rede é
// tentada por causa disto (`AppModule` não importa `TypeOrmModule`).
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3001';
process.env.DATABASE_URL ??=
  'postgresql://fake-user:fake-pass@fake-host.invalid:5432/fake_db';
process.env.DIRECT_URL ??=
  'postgresql://fake-user:fake-pass@fake-host.invalid:5432/fake_db';
