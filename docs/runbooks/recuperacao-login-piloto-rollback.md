# Recuperação do login do piloto: retorno de API e web para `8e8577d`

**Status: proposta. Nada foi executado.** Cada passo marcado como escrita só pode ser feito com autorização explícita.

Diagnóstico completo: `docs/plans/login-limpeza-e-falha-de-acesso.md` (PR #112). Resumo: a API live (`23fda23`) lê `tenants.is_test`, que vem da migração 17. A migração não está no banco do piloto, por isso `POST /auth/login` e `GET /auth/me` (com cookie) respondem 500 desde 2026-11-11 20:14 UTC.

## 1. Estado lido no Render (2026-11-12, 20:00 UTC, só leitura)

| Serviço | ID | Deploy live | Commit | Live desde |
|---|---|---|---|---|
| API `agenda-cloud-piloto-api` | `srv-db8n2scs728c73aaosr0` | `dep-dbqcnsdbedkc73d6aieg` (manual) | `23fda23` | 2026-11-11 20:13 UTC |
| Web `agenda-cloud-piloto-web` | `srv-db8n2scs728c73aaosj0` | `dep-dbr1jajm8hqs73c9ut70` (manual) | `187c507` | 2026-11-12 19:57 UTC |

- **Auto-Deploy:** desligado nos dois (`autoDeploy: no`, gatilho `off`). Os dois serviços acompanham a branch `integration/nestjs-typeorm-frontend`.
- **Deploys da API que falharam hoje** (a versão live continuou no ar): `b5e5586` às 19:16, `187c507` às 19:28 e `187c507` às 19:56 UTC. Nos três, a causa é `PLATFORM_2FA_ENFORCEMENT, PLATFORM_TOTP_KEYS` ausentes.
- **Instância:** plano Free nos dois serviços, região Virginia. Não há grupos de variáveis na conta.

### Histórico relevante

| Commit | API live | Web live | Lê `is_test` | Erros de login no log |
|---|---|---|---|---|
| `879cef8` | 2026-11-09 13:12 a 13:26 | 13:16 a 13:27 | não | nenhum |
| **`8e8577d`** | **2026-11-09 13:26 a 2026-11-11 13:50** | **2026-11-09 13:27 a 2026-11-11 13:53** | **não** | **nenhum** |
| `43ed0f9` | 2026-11-11 13:50 a 20:13 | 13:53 a 20:14 | **sim** (entidade `Tenant`) | nenhum, mas ninguém entrou (veja abaixo) |
| `23fda23` | desde 2026-11-11 20:13 | 20:14 a 2026-11-12 19:18 | sim | `column Tenant.is_test does not exist`, desde 20:14 |

## 2. Escolha do alvo

**Alvo: `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2` (C_final, Portal AC), na API e no web.**

Por que este commit, e não outro:

- **`43ed0f9` não serve.** Ele já declara a coluna `isTest` na entidade `Tenant`, então qualquer leitura de estabelecimento falha num banco sem a migração 17. Não houve erro no log enquanto ele esteve no ar porque, ao que tudo indica, ninguém tentou entrar nesse intervalo. Ausência de erro ali não prova que funcionava.
- **`8e8577d` é o último par que esteve no ar junto, no mesmo SHA, antes de qualquer código que lê `is_test`.** Ficou live por cerca de 48 horas, sem nenhum log de nível `error`. A API registra os erros de login nesse nível, como mostram os 500 da `23fda23`.
- **`5d74556` (comissões em massa) nunca foi publicado sozinho.** Ele também é compatível com o estado 16, mas não é um conjunto comprovado em produção. A publicação dele segue o roteiro próprio, depois da recuperação.

**Limite da evidência:** a API não registra requisições bem-sucedidas, e o Render não expõe logs nem métricas HTTP para estes serviços. Não há, portanto, registro direto de um login bem-sucedido em `8e8577d`. A prova de que o login voltou é a verificação da seção 5, feita depois do retorno.

### Rollback do painel ou deploy novo do commit

**Use um deploy novo do commit (`render deploys create --commit`), não o botão Rollback.**

- No plano Free, o Render só permite rollback para os dois deploys anteriores mais recentes (https://render.com/docs/free). No web, o deploy de `8e8577d` (`dep-dbosjeajnfac73ftrio0`) é o sexto anterior, então o artefato não está disponível. Na API, o deploy de `8e8577d` (`dep-dbosjcijnfac73ftrdug`) é o segundo anterior bem-sucedido, depois de `43ed0f9`, mas vem depois de três deploys com falha. A documentação não diz se os deploys com falha contam para o limite. Só o botão no painel mostraria isso, e consultar o painel não altera nada.
- Mesmo que estivesse, o rollback reaproveita as variáveis de ambiente do deploy alvo, de 09/11. O deploy novo usa as variáveis atuais, já conferidas na seção 3.
- `render deploys create <srv> --commit <sha> --wait --confirm` foi o caminho usado nos retornos de 2026-11-05 e na publicação de 2026-11-09. O build parte do `package-lock.json` do commit, com Node `>=24 <25`.

## 3. Compatibilidade conferida

**Código contra o banco:**

- `8e8577d` traz 16 migrations (a última é `1793577600000-ProfessionalCommissionSettings`). Não declara `is_test` nem nada do segundo fator (migração 18, `AdminSecondFactor`).
- `synchronize` e `migrationsRun` são `false`: a API não altera o schema ao subir.
- A única diferença de entidades entre `8e8577d` e `43ed0f9` é `Tenant.isTest`.

**Variáveis (só os nomes foram lidos):**

- **API:** `API_PROXY_SECRET CLIENT_IP_SOURCE DATABASE_URL DIRECT_URL EMAIL_API_KEY EMAIL_FROM EMAIL_FROM_NAME EMAIL_PROVIDER FRONTEND_URL HOST NODE_ENV WEB_PUSH_SUBJECT WEB_PUSH_VAPID_PRIVATE_KEY WEB_PUSH_VAPID_PUBLIC_KEY`. O `env.validation.ts` de `8e8577d` é idêntico ao de `23fda23`, que subiu com essas variáveis. O deploy de hoje, com o validador maior do `b5e5586`, só reprovou as variáveis do 2FA. Nenhuma variável `PLATFORM_*` existe no serviço, e a versão antiga não precisa delas.
- **Web:** `API_PROXY_SECRET API_PROXY_TARGET CLIENT_IP_SOURCE NEXT_PUBLIC_API_URL`. São os mesmos nomes lidos por `8e8577d` e por `187c507`.
- **Grupos de variáveis:** nenhum na conta.

**Destino:**

- `DATABASE_URL` aponta para o pooler do endpoint do piloto (`ep-orange-bread-b7f8iike`) e `DIRECT_URL` para o mesmo endpoint, sem pooler. Nenhuma das duas aponta para o endpoint proibido. As duas usam `sslmode=verify-full`.
- `API_PROXY_TARGET` do web é `https://agenda-cloud-piloto-api.onrender.com`. `FRONTEND_URL` da API é `https://agenda-cloud-piloto-web.onrender.com`.
- Nenhum valor secreto foi impresso.

**Dados gravados pelas versões novas:** nenhum. Login e consulta de sessão falham para todos desde que `43ed0f9` entrou (2026-11-11 13:50 UTC). As telas autenticadas exigem a sessão, então nada pôde ser gravado pelas versões novas. Para o caso das comissões, o runbook `publicacao-comissoes-em-massa-piloto.md` já registra que dados de `5d74556` continuam válidos para `8e8577d`.

### Conferência que falta (só leitura no banco do piloto, depende de autorização)

O erro de coluna ausente prova só que a migração 17 não foi aplicada. Ele não prova que o banco está exatamente no estado 16. A última conferência registrada é de 2026-11-09 13:10 UTC (kit da migração 16, `after-commission-settings`). Para fechar essa lacuna antes do retorno:

```bash
# numa cópia limpa de 187c507, em backend/, com PILOT_DIRECT_URL,
# PILOT_ENDPOINT_ID e PRODUCTION_ENDPOINT_ID do piloto; npm ci antes
PILOT_EXPECT=before-tenant-test-flag npm run pilot:check-database
```

**Esperado:** `RESULT: SUCCESS`, `MIGRATIONS_APPLIED: 16`, `SCHEMA_OBJECTS_OK: 0/2`, `MARCADOS_COMO_TESTE: coluna ainda não existe` e `BASELINE_FAILURES: none`. O script só lê (cabeçalho de `scripts/run-check-pilot-database.ts`). **Não use** `migration:show`, porque ele escreve em `typeorm_migrations`.

Se essa conferência não for autorizada, o retorno ainda pode ser feito. Nesse caso, a verificação da seção 5 passa a ser a única prova de compatibilidade, e qualquer erro de schema no log interrompe o roteiro.

## 4. Sequência

**Ordem: web primeiro, API depois.** Enquanto o web volta, o login já está quebrado, então a combinação intermediária (web `8e8577d` com API `23fda23`) não piora nada. A ordem contrária deixaria o web `187c507` falando com a API `8e8577d` quando o login voltasse; essa combinação não foi testada. O retorno de 2026-11-05 seguiu a mesma ordem.

0. **Pré-condições (só leitura).**
   - `render deploys list` mostra exatamente os deploys live da seção 1. Se houver deploy mais novo, pare e releia.
   - Opcional, mas recomendado: a conferência da seção 3.
   - Anote o horário de início.
1. **Web** (escrita):
   ```bash
   render deploys create srv-db8n2scs728c73aaosj0 --commit 8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2 --wait --confirm
   ```
   - **Sucesso:** o novo deploy fica `live` com commit `8e8577d`, `GET /login` responde 200 e a página inicial não mostra o nome TimVix.
   - **Interrompa se** o build ou o deploy falhar. O Render mantém `187c507` no ar, e nada mais deve ser feito.
2. **API** (escrita), só depois do passo 1 confirmado:
   ```bash
   render deploys create srv-db8n2scs728c73aaosr0 --commit 8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2 --wait --confirm
   ```
   - **Sucesso:** o deploy fica `live` com commit `8e8577d`, o log mostra `Nest application successfully started` e não mostra `Configuração de ambiente inválida`.
   - **Interrompa se** falhar. A `23fda23` continua no ar: o login segue quebrado, mas não piora. Não volte o web; leia o log e decida.
3. **Verificação** (seção 5).

**Critérios gerais de interrupção:**

- qualquer `does not exist`, `42703`, `42P01` ou `QueryFailedError` no log da API depois do passo 2;
- login real falhando com a API `8e8577d` no ar.

**Em qualquer um desses casos:**

- não tente outro commit por conta própria;
- não aplique migração;
- registre o horário e a mensagem.

A alternativa, nesse caso, é a migração 17 pelo runbook dela, com autorização própria.

## 5. Verificações da recuperação

O health check do Render (`/` na API, `/login` no web) só prova que o processo subiu. Ele **não** prova que o login funciona, porque o erro de `is_test` só aparece quando a API lê os estabelecimentos de uma conta.

1. **Sem credenciais:** `GET https://agenda-cloud-piloto-web.onrender.com/agenda_api/auth/me` sem cookie responde **401** rapidamente. Isso prova o caminho navegador → proxy → API, mas não o login.
2. **Login real (feito pelo responsável, com a própria conta; a senha nunca entra em conversa ou log):**
   - em `/login`, entrar com uma conta de dono ou equipe do piloto. Esperado: abre `/conta`, sem a faixa de aviso e sem "Não foi possível entrar agora";
   - recarregar a página. Esperado: a sessão continua; isso prova `GET /auth/me` com cookie respondendo 200;
   - sair e entrar de novo;
   - entrar no portal (`/portal`) com uma conta da administração da plataforma.
3. **Log da API desde o passo 2:** nenhum `is_test`, `42703` ou outro erro durante os acessos do item 2.
4. **Telas que dependem do par no mesmo SHA:**
   - agenda do dia;
   - tela de comissões de um profissional. Esperado: abre sem "Não foi possível carregar";
   - página pública de agendamento de um estabelecimento real (`/agendar/<slug>`).
5. **Render:** os dois serviços live em `8e8577d`, Auto-Deploy ainda desligado.

## 6. O que deixa de aparecer temporariamente

| Lote | Onde estava visível hoje | Efeito do retorno |
|---|---|---|
| #111 página inicial repaginada e nome TimVix | web live (`187c507`) | volta a página inicial anterior e o nome antigo |
| #104 SEO, cabeçalhos de segurança, `noindex` nas áreas privadas, sitemap, robots, 404 real nas páginas públicas | web live | **sai a proteção de cabeçalhos e o `noindex` das áreas privadas**; volta o comportamento de 09/11 |
| #110 manifesto único do portal | web live | volta o manifesto duplicado em aparelhos lentos (defeito conhecido) |
| #102 comissões em massa | web live; API live sem funcionar (login quebrado) | a tela de aplicação em massa some |
| #105 marca de estabelecimento de teste e slugs reservados | idem | some a marca no portal; a API para de recusar os slugs reservados |
| #106 portal separa clientes de internos/teste | idem | some a separação |
| #108 relatórios por período no portal | idem | some `/portal/relatorios` |
| #109 segundo fator da administração | nunca esteve no ar (a API não subiu) | sem efeito |

Na prática, nenhum desses lotes funcionava no piloto, porque o login estava quebrado. Os efeitos reais para quem usa são três: a página inicial e o nome voltam ao anterior, e saem os cabeçalhos de segurança e o `noindex` das áreas privadas do #104.

## 7. Depois da recuperação: fila de publicação

Com API e web em `8e8577d` e o banco no estado 16, o piloto volta ao ponto de partida que os roteiros já assumem:

1. **Comissões em massa (`5d74556`)**, pelo `publicacao-comissoes-em-massa-piloto.md`. Sem migração; o passo 0 desse roteiro exige API e web em `8e8577d`.
2. **Migração 17 e lotes #104 a #108**, pelo `publicacao-tenant-teste-slugs.md`: backup, conferência, migração, API, web.
3. **2FA (#109, migração 18)**, pelo `publicacao-2fa-administrativo.md`. Exige **todos** os requisitos do roteiro, inclusive as três variáveis `PLATFORM_TOTP_KEYS`, `PLATFORM_TOTP_KEY_CURRENT` e `PLATFORM_2FA_ENFORCEMENT`, não só as duas citadas no erro de inicialização.
4. **#111 (página inicial, TimVix)** e **#112 (limpeza do login)**, junto com o que estiver em `integration`, no mesmo SHA para API e web.

Nenhum deploy de `integration` à frente de `8e8577d` deve ser feito antes de a migração correspondente estar aplicada.
