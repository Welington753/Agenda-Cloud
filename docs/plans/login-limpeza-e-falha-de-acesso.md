# Login: limpeza da tela e falha de acesso no piloto

Branch `fix/login-limpeza-acesso`, a partir de `integration/nestjs-typeorm-frontend` em `187c507`.

## 1. Limpeza da tela de login

Saíram do `/login`:

- o bloco "Ambiente de demonstração (sem conta real)" e as contas simuladas;
- o cartão "Você é um consumidor?" com o link "Ver exemplo".

Ficaram o formulário, "Esqueci minha senha", "Ainda não tem acesso? Saiba como obter" e "← Voltar para a apresentação". Os dois links finais agora ficam juntos, abaixo de uma linha divisória.

A demonstração continua na página inicial ("Ver demonstração", `/onboarding`). Como o login não importa mais nenhum módulo da demonstração, a exceção das guardas foi removida:

- `src/lib/servicos/excecoes-demonstracao.ts` foi apagado;
- `sem-dados-demo.test.ts` e `sem-dados-demo-transitivo.test.ts` agora reprovam qualquer import da demonstração na área real, inclusive no `/login`;
- a regra correspondente no `CLAUDE.md` foi atualizada.

## 2. Falha de acesso: diagnóstico

O ambiente investigado foi o **publicado**: na máquina não havia web nem API locais rodando. A investigação usou só leitura: logs e lista de deploys pelo Render CLI, mais requisições sem credenciais.

### Estado dos serviços em 2026-11-12, às 20:00 UTC

| Serviço | Deploy live | Commit |
|---|---|---|
| API | `dep-dbqcnsdbedkc73d6aieg`, manual, live desde 2026-11-11 20:13 UTC | `23fda23` |
| Web | `dep-dbr1jajm8hqs73c9ut70`, manual, live desde 2026-11-12 19:57 UTC | `187c507` |

Auto-Deploy está desligado nos dois serviços (`autoDeploy: no`, gatilho `off`).

Três deploys manuais da API falharam hoje e não substituíram a versão live: `b5e5586` às 19:16 UTC, `187c507` às 19:28 UTC e `187c507` de novo às 19:56 UTC. Nos três, o log diz `Configuração de ambiente inválida ou incompleta. Campos com problema: PLATFORM_2FA_ENFORCEMENT, PLATFORM_TOTP_KEYS.` O web foi publicado em `187c507` duas vezes (19:30 e 19:57 UTC); a segunda é a live.

### Causa

A API live (`23fda23`) lê a coluna `tenants.is_test`, que vem da migração 17 (`TenantTestFlag1793664000000`). O banco do piloto não tem essa coluna. Por isso as duas rotas abaixo falham:

- `GET /auth/me` com cookie de sessão: `AuthController.me`;
- `POST /auth/login`: `AuthController.login`.

Nas duas, `AuthService.loadTenantContexts` termina em `QueryFailedError (code=42703): column Tenant.is_test does not exist`, e a resposta é 500. O primeiro erro aparece às 2026-11-11 20:14 UTC, um minuto depois de a API `23fda23` ficar live, e se repete até 19:34 UTC de hoje. Sem cookie, `/auth/me` responde 401 em cerca de 0,5 s pelo proxy, então hibernação e senha não explicam a falha.

### O que o usuário via

- **Abertura do login:** a consulta da sessão recebia 500, mas a faixa mostrava "O servidor não respondeu a tempo". O texto estava errado: o servidor respondeu, só que com erro. A tela da conta (`RequireRealSession`) já distinguia os dois casos; o formulário de login não.
- **Envio do formulário:** o 500 do `POST /auth/login` aparecia como "Não foi possível entrar agora. Tente novamente em instantes." Esse texto genérico está correto para um erro do servidor.

## 3. Correção de código (só a mensagem)

- `avisoDaConexao` em `src/lib/auth/conexao.ts` usa o motivo que a leitura da sessão registrou.
- `FaixaConexao` ganhou o aviso `erro_servidor`: "O servidor respondeu com um erro. O que está na tela foi mantido."
- Nenhum timeout foi alterado e nenhuma nova tentativa foi adicionada.

Regressões:

- `src/lib/auth/conexao.test.ts`;
- `tests/browser/recuperacao-hibernacao-flow.spec.ts`, teste "500 da própria API no login". Ele falha no código base (`faixa-conexao-erro-servidor` não aparece) e passa com a correção.

**O login publicado só volta a funcionar com uma ação no ambiente, não com este PR.**

## 4. Ação necessária no ambiente publicado (não executada)

Cada passo só deve ser feito com pedido explícito, pelo runbook correspondente.

1. **Para o login voltar:** há duas saídas. A primeira é voltar a API e o web para um commit que não leia `is_test`. A segunda é aplicar a migração 17 no piloto, seguindo `docs/runbooks/publicacao-tenant-teste-slugs.md` (backup e `pilot:check-database` antes e depois). A recuperação operacional é tratada fora deste PR.
2. **Comissões:** o código das comissões em massa (`5d74556`) está na API live `23fda23`, mas a publicação funcional nunca foi validada, porque o login falha desde que essa API entrou. A fila de publicação registrada antes (comissões, depois migração 17, depois 2FA) partia de API e web em `8e8577d` e precisa ser reconciliada com o estado real. A API e o web estão em SHAs diferentes (`23fda23` e `187c507`).
3. **Deploy da API `b5e5586` ou posterior:** exige as migrações 17 e 18 e todos os requisitos de `docs/runbooks/publicacao-2fa-administrativo.md`, inclusive as três variáveis `PLATFORM_TOTP_KEYS`, `PLATFORM_TOTP_KEY_CURRENT` e `PLATFORM_2FA_ENFORCEMENT`. O erro de inicialização cita só duas, mas o runbook exige as três. Sem elas, a API não sobe; foi o que fez os deploys de hoje falharem.

## Estado e retomada

- **Feito:** limpeza do login; guardas sem exceção; correção da mensagem e regressões.
- **Validação local**, com banco descartável TLS (18 migrações) e conta fictícia:
  - `test:browser:recuperacao`: 13/13;
  - `test:browser:auth`: 7/7;
  - login real no computador (1280 px) e no celular (390 px), sem rolagem horizontal;
  - Vitest: 1071/1071; lint, lint:types e tsc limpos.
- **Não feito:** nenhuma das ações no ambiente publicado.
- **Próximo passo:** CI do PR verde no head final. A recuperação do login publicado (rollback ou migração 17) segue em separado e depende de autorização.
- **Só neste computador:** os prints da validação e o banco `loginfix` no cluster descartável.
