# Publicação segura: a API não sobe sem as migrations que exige

Branch `feat/publicacao-segura`, a partir de `integration/nestjs-typeorm-frontend` em `438e598`. Só backend e documentação. Sem migration, sem variável de ambiente nova e sem mudança no `render.yaml`.

## 1. O problema

Em 11/11/2026 a API `23fda23` foi publicada antes da migration 17. Ela subiu normalmente e só falhou na primeira consulta: `/auth/login` e `/auth/me` responderam 500 (`column Tenant.is_test does not exist`) até a volta para `8e8577d` em 13/11 (`login-limpeza-e-falha-de-acesso.md`). O mesmo tipo de falha já tinha acontecido em 05/11, com as migrations de comissões.

O que foi conferido antes de mudar:

- **Inicialização (`backend/src/main.ts`):** `NestFactory.create` abre a conexão; `app.listen` roda os ganchos dos módulos e passa a escutar. Nada conferia o schema.
- **TypeORM de runtime (`runtime-data-source.ts`):** `migrations: []`, `migrationsRun: false`, `synchronize: false`. O runtime nunca lê `typeorm_migrations`.
- **Build de produção (`nest build`, `tsconfig.build.json`):** compila as 18 migrations em `dist/migrations/`, embora o runtime não as carregue. Cada classe tem `name` fixo, que é o valor gravado na tabela de controle.
- **Health check (`render.yaml`):** `GET /`, que responde "Hello World!" sem tocar no banco.

## 2. A solução

### Conferência na inicialização

- **Manifesto:** `backend/src/database/required-migrations.ts` importa estaticamente as 18 classes e expõe os nomes (`REQUIRED_MIGRATIONS`). Sem glob em tempo de execução: o que vai para o `dist` é exatamente essa lista. `required-migrations.spec.ts` reprova uma migration do diretório fora do manifesto e um nome que não exista no diretório.
- **Conferência:** `backend/src/database/schema-readiness.ts`, chamada em `main.ts` depois de `NestFactory.create` e antes de `app.listen`. Nesse ponto nenhum gancho de módulo rodou e nenhuma porta escuta.
- **Só leitura:** uma transação `READ ONLY` com `statement_timeout`; `to_regclass` para saber se a tabela de controle existe; `SELECT name`; `ROLLBACK`. Nada é criado, alterado ou aplicado. `migrationsRun` e `synchronize` continuam `false`. (`migration:show`, ao contrário, cria a tabela de controle; ele não é usado aqui.)
- **Comparação:** pelo nome de cada migration do manifesto. Não compara quantidade nem só a última.
- **Recusa:** registra o diagnóstico e termina o processo com código 1, sem escutar a porta.

| Situação do banco | Resultado |
|---|---|
| Todas as exigidas registradas | Sobe. Log: `18 de 18 registradas no banco`. |
| Falta qualquer exigida (a última ou uma anterior) | Não sobe. O log lista todas as ausentes. |
| Tabela `typeorm_migrations` ausente | Não sobe. A tabela não é criada. |
| Banco indisponível, conexão recusada ou sem resposta | Não sobe. O log traz só o código do driver. |
| Migration a mais, desconhecida deste código | Sobe, com aviso no log. |

O log traz nomes de migration, o nome da tabela e o código do erro do driver. Nunca URL de conexão, usuário, senha ou a mensagem crua do driver.

### Health check separado

`GET /health` (`backend/src/health/`) responde se o banco atende agora, com um `SELECT 1`. Não lê a tabela de controle e não repete a conferência de migrations.

- `200 {"status":"ok"}` ou `503 {"status":"unavailable"}`, sempre com `Cache-Control: no-store`. O corpo nunca traz o motivo.
- Pública e sem sessão. Por isso tem limite de carga: sucesso reaproveitado por 5 s, uma consulta por vez e nenhuma consulta nova enquanto uma anterior estiver pendurada.

### Prazos e o health check do Render

Comportamento documentado em `render.com/docs/health-checks`, lido em 13/11/2026:

| Regra do Render | Valor |
|---|---|
| Resposta saudável | 2xx ou 3xx em até 5 s |
| Frequência | "a cada poucos segundos" (sem número) |
| Instância em serviço com falhas seguidas | 15 s: sai do tráfego; 60 s: é reiniciada |
| Deploy novo que não fica saudável | cancelado em 15 min; a versão anterior continua atendendo |

Decisões:

- **Sonda do `/health`: 3 s.** Abaixo dos 5 s do Render, para a API responder 503 em vez de o Render estourar o próprio prazo.
- **Sem contagem própria de falhas.** Uma falha isolada (banco acordando, oscilação) não derruba nada: quem decide são os 15 s seguidos do Render.
- **Conferência de inicialização: 5 s por comando no servidor e 10 s no total.** Antes dela, o `@nestjs/typeorm` já tenta a conexão 9 vezes com 3 s de intervalo (comportamento existente, não alterado): com o banco fora, o processo termina em cerca de 27 s.
- **Processo que termina antes de escutar:** o Render nunca recebe resposta saudável e mantém a versão anterior. Foi o que aconteceu nos deploys de 12 e 13/11 que pararam na validação de ambiente (`update_failed`, versão anterior mantida). A documentação do Render não descreve esse caso literalmente.

## 3. Contratos

- **`GET /` não mudou:** 200 "Hello World!", sem tocar no banco. Continua sendo o `healthCheckPath` do `render.yaml`.
- **`GET /health` é rota nova.** Nenhuma rota existente mudou de forma, status ou autorização.
- **`render.yaml` não mudou, de propósito.** O Blueprint do Render sincroniza sozinho a cada push que altera o arquivo e reimplanta os serviços afetados. Trocar o `healthCheckPath` neste PR apontaria o serviço publicado para uma rota que a versão no ar ainda não tem.
- **Mudança de comportamento, intencional:** uma API cujo banco não tem todas as migrations do manifesto deixa de subir. Vale também em desenvolvimento e nos testes de navegador, que sobem `node dist/main.js`: o banco local precisa de `migration:run` antes, como já era necessário para o sistema funcionar.

## 4. Limitações

- **Não garante compatibilidade com schema mais novo.** Migration a mais não bloqueia, para permitir banco adiantado durante a publicação e rollback da API. Uma migration futura pode remover ou mudar algo que este código usa; a conferência não percebe. Essa compatibilidade continua sendo do roteiro de cada lote.
- **Confere o registro, não o schema.** O nome em `typeorm_migrations` diz que a migration foi registrada. Schema alterado à mão ou registro inserido sem aplicar não são detectados.
- **Fotografia da inicialização.** Uma migration revertida com a API no ar só é percebida no próximo início.
- **A ordem de publicação continua manual.** A conferência impede a API adiantada de entrar em serviço; ela não aplica nada nem impede publicar web e API em SHAs diferentes.
- **O health check do Render ainda usa `GET /`.** Até a troca (seção 5), uma queda do banco com a API no ar não é vista pelo Render.
- **Depois da troca para `/health`:** 60 s de banco fora reiniciam a instância, e o reinício só completa quando o banco voltar (a conferência de inicialização exige o banco). Enquanto a API estiver acordada, a sonda consulta o banco a cada 5 s no máximo, o que pode impedir o Neon de suspender por inatividade nesse período. A documentação do Render não diz se o health check conta como tráfego para a hibernação do plano gratuito. Esses pontos precisam ser pesados antes da troca.

## 5. Publicação

Este lote não tem migration nem variável nova. Publicar a API deste commit num banco que não tenha as 18 migrations faz o deploy falhar e manter a versão anterior, que é o comportamento desejado. A fila continua a mesma: migration, depois API, depois web, pelo runbook de cada lote.

Troca do health check, **passo separado, não executado e só com pedido explícito:**

1. Publicar uma API que já tenha `GET /health` e conferir que ela responde 200 no ambiente publicado.
2. Só então mudar `healthCheckPath` da API para `/health` em `render.yaml`, num PR próprio. O merge sincroniza o Blueprint e reimplanta o serviço.
3. Se a API voltar a um commit anterior a este lote, voltar antes o `healthCheckPath` para `/`.

## 6. Validação

PostgreSQL 18 descartável local, com TLS e certificado autoassinado confiado por `NODE_EXTRA_CA_CERTS`. Só dados fictícios. Um banco por cenário, e o processo real (`node dist/main.js`):

| Cenário | Resultado observado |
|---|---|
| 1. Todas as exigidas presentes | No ar em 3,3 s; `/` 200; `/health` 200 |
| 2. Última ausente (`AdminSecondFactor1793750400000`) | Saída 1 em 3,2 s; nenhuma porta aberta; log nomeia a ausente |
| 3. Anterior ausente (`TenantTestFlag1793664000000`), última registrada | Saída 1 em 3,2 s; log nomeia a ausente |
| 4. Tabela de controle ausente | Saída 1 em 3,3 s; a tabela continuou inexistente depois |
| 5a. Banco indisponível na inicialização | 9 tentativas de conexão; saída 1 em 27 s |
| 5b. Banco cai com a API no ar | `/health` 503 em até 2 s, `/` segue 200; banco de volta, `/health` 200 |
| 6. Migration adicional | No ar; aviso no log com o nome da migration desconhecida |

Em nenhum cenário a senha ou a URL do banco apareceu no log.

Testes automatizados:

- `src/database/required-migrations.spec.ts`, `schema-readiness.spec.ts`, `src/health/database-probe.spec.ts` e `src/main.spec.ts` (ordem da inicialização);
- `test/health.e2e-spec.ts` (contrato de `/health` e `/` inalterado);
- `test/schema-readiness-postgres.db-e2e-spec.ts`: os seis cenários contra PostgreSQL real, numa tabela de controle própria em schema temporário (a `typeorm_migrations` verdadeira, lida por outros testes, não é tocada), mais a prova de que a transação recusa escrita.

## Estado e retomada

- **Feito:** manifesto, conferência na inicialização, `GET /health`, testes e esta documentação (mapa técnico, runbook do Render e `CLAUDE.md`).
- **Validação local:** `typecheck`, `lint`, unitários, `test:e2e` e `test:db-e2e` completo em banco novo; os sete cenários da seção 6 com o processo real.
- **Não feito, de propósito:** nenhuma mudança no `render.yaml`, no Render ou em banco real; nenhum deploy; nenhuma migration.
- **Próximo passo:** revisão do PR com o CI verde no head final. Sem merge até aprovação.
- **Depois do merge, cada um com pedido explícito:** a fila de publicação pelos runbooks e, à parte, a troca do `healthCheckPath` (seção 5).
- **Migration nova, daqui em diante:** acrescentar a classe ao manifesto no mesmo PR; o teste ao lado reprova o esquecimento.
- **Pendência separada:** o teste de login real no piloto.
- **Só neste computador:** o cluster descartável da validação, na pasta temporária da sessão.
