# Continuidade: comissões completas no piloto (migrations 15 e 16)

Estado entre sessões, escrito no PC do trabalho em 05/11/2026 para continuar no
PC de casa. **Nada foi executado no piloto, no Neon ou em `agenda_dev`:**
nenhum backup, restauração, migration ou deploy feito por esta preparação.

Procedimento completo: `publicacao-regra-geral-comissoes-piloto.md` (15 e 16)
e `publicacao-comissoes-profissionais-piloto.md` (kit da 15). Esta nota não
substitui os runbooks; só registra onde o trabalho parou.

## Último estado relatado do piloto (não reconferido)

Este é o último estado **visto em 05/11/2026**, pelos logs e pelo Render CLI,
durante o diagnóstico da falha em "Comissões de Luiza". **Não é uma
conferência nova:** confira de novo em casa antes de qualquer passo.

- API e web publicados manualmente em `92cc6ae99856ce43c019f25125bd4140cb916133`.
  Auto-Deploy desligado nos dois serviços.
- Banco com **14 migrations**: os objetos da 15 não existiam. Os logs
  mostravam:
  - `column ce.appointment_item_id does not exist` no relatório;
  - `invalid input value for enum audit_action` ao gravar regra (500).
- **Combinação incompatível:** a API `92cc6ae` exige a migration 15. Onde há
  comissões (Max, Básico com exceção ligada), concluir atendimento, o
  relatório e a gravação de regra respondem 500.
- A contenção (voltar web e API para `2656f691bbd43123d49b48e65b8edb08c1061d68`)
  é decisão do dono e **não** foi feita.

## Branches, PRs e commits

| PR | Branch (head) | Base | Estado |
| --- | --- | --- | --- |
| #98 funcionalidade (migration 16 e telas) | `feat/comissoes-recebe-regra-geral` em `0ff8f46f3ad84c848a176d97729585decf1629f1` | `integration/nestjs-typeorm-frontend` em `92cc6ae99856ce43c019f25125bd4140cb916133` | aberto, sem merge, sem auto-merge |
| #99 kit da 16 e runbook | `ops/kit-regra-geral-comissoes` (head: o commit desta nota) | `feat/comissoes-recebe-regra-geral` (**empilhado sobre o #98**) | aberto, sem merge, sem auto-merge |

Commits do #99, em ordem:

| SHA | Conteúdo |
| --- | --- |
| `78d37027baca24b20af05f4ace87df76a27f7a3d` | kit da 16 (lançador, fases, conferência, consultas, testes) |
| `e42fb815e16924161813dead93b0b24f714b3be3` | correção da fixture do db-e2e. **Commit do ensaio do kit da 16** |
| `c8fa3fde586aa39ed1d05bac86cf22c1c423b491` | runbook (só `docs/`) |
| `653b75f5fd7e118ec173a81d53e6bfad592d3752` | runbook: rollback sobre o schema 16 não é recuperação equivalente (só `docs/`) |
| commit desta nota | esta nota (só `docs/`) |

De `e42fb81` em diante só mudou `docs/`. Backend, frontend, scripts e
workflows são idênticos aos ensaiados.

## CI e o que foi testado em cada commit

| Commit | Teste | Resultado |
| --- | --- | --- |
| `0ff8f46` | `test-frontend-auth` (PR #98) | sucesso, run 42070458612 |
| `0ff8f46` | `test-migration-lote6b2` (PR #98) | sucesso |
| `c8fa3fd` | `test-migration-lote6b2` (dispatch) | sucesso, run 42078040203 |
| `c8fa3fd` | `test-frontend-auth` (dispatch) | **cancelado**, run 42078035802. A instalação do Playwright levou 647 s e estourou o limite de 20 min (infraestrutura) |
| `653b75f` | `test-frontend-auth` (dispatch) | sucesso, run 42081376696 |
| commit desta nota | nenhum | só `docs/`; nenhum workflow rodado |
| `92cc6ae` | kit da 15, ensaio 14 → 15 completo | passou |
| `e42fb81` | kit da 16, ensaio 15 → 16 completo e 17 rodadas de recusa e falha | passou |
| `e42fb81` | db-e2e completo local, PostgreSQL 17.11 | 30 arquivos, 283 testes |
| `2656f69`, `92cc6ae`, `0ff8f46` + kit | matriz de compatibilidade por HTTP real nos estados 14, 15 e 16 | ver runbook, "Compatibilidade" |

PR empilhado não dispara os workflows (eles só rodam em PR para a
integração). No #99 foram disparados por `workflow_dispatch`, com bancos
descartáveis e dados fictícios.

## Feito e falta

**Feito:**

- funcionalidade (#98): "Recebe comissão" por profissional e regra geral
  opcional, migration 16;
- kit protegido da 16, consultas só leitura, testes e ensaio completo;
- runbook da sequência 14 → 15 → 16, com janela de transição, compatibilidade
  e recuperação.

**Falta, nesta ordem:**

1. Revisar o #98 e o #99.
2. Mesclar o #98 na integração, com `[skip render]`.
3. Trocar a base do #99 para a integração, se o GitHub não trocar sozinho, e
   mesclá-lo com `[skip render]`. O merge do #99 é o **C16**.
4. Publicar no piloto, em casa, conforme a sequência abaixo.

**Merge não publica:** Auto-Deploy desligado; todo deploy é manual.

## Kits: cada um no seu SHA

| Kit | SHA operacional | Por quê |
| --- | --- | --- |
| da 15 | `92cc6ae99856ce43c019f25125bd4140cb916133` | único commit com o kit da 15 **e exatamente 15 migrations** |
| da 16 | **C16** (merge do #99) | kit ensaiado em `e42fb81`; confira `git diff e42fb81 <C16> -- backend/scripts backend/src` vazio |

- **Nunca execute o kit da 15 a partir de código com 16 migrations.** Ele
  recusa (`ERR_MIGRATIONS_COMPILADAS_INESPERADAS`), mas a regra vale por
  princípio: a 15 roda só na worktree em `92cc6ae`.
- Use uma worktree limpa por kit, com `npm ci` próprio em `backend`. No ensaio,
  `node_modules` foi junção por falta de disco; na operação real, não.
- Se a integração receber outro merge antes do C16 e o diff acima não sair
  vazio, pare e reavalie antes de usar o kit.

## Sequência em casa (resumo dos runbooks)

Cada `aplicar` e cada deploy exige autorização expressa do dono naquele
momento. Qualquer `ERRO:` para a sequência.

1. **Conferir o estado real, só leitura.**
   - Render: SHA Live da API e do web.
   - Fase `conferir` do kit da 15, na worktree em `92cc6ae`. Esperado:
     `before-professional-commissions`, 14 migrations.
   - Se divergir do último estado relatado, pare e reavalie.
2. **Definir os SHAs operacionais:** `92cc6ae` para o kit da 15 e para a API e o
   web do estado 15; C16 para o kit da 16 e para a API e o web finais.
3. **Migration 15** (kit da 15, `92cc6ae`): `conferir` → `preparar` (backup) →
   `restauracao` (restauração conferida, sem conexão com o piloto) → `aplicar`
   → `conferir`. Esperado: `after-professional-commissions`, `15/15`.
   - API e web já estão em `92cc6ae`: sem deploy. Se houve contenção para
     `2656f69`, publique `92cc6ae`, API e depois web.
   - **Ponto de parada estável.** Pode ficar dias aqui.
4. **Migration 16** (kit da 16, C16), em outra sessão, com janela combinada:
   1. `conferir` (`before-commission-settings`).
   2. Consulta de impacto e combinação da janela com os donos.
   3. `preparar` (backup) → `restauracao` (conferida).
   4. `aplicar`; a janela começa aqui (`JANELA_DESDE`).
   5. Deploy da API C16, depois do web C16.
   6. `conferir` com `JANELA_DE_TRANSICAO: ok`; fim da janela.
5. **Publicação sempre migration → API → web.** Voltar é web → API.

**Backups e restaurações reais só no PC de casa,** na pasta
`%USERPROFILE%\AgendaCloud-operacoes`, fora do repositório.

## Janela de manutenção e limites do rollback

- **Na janela da 16** (da frase do `aplicar` até o web C16 Live e
  `JANELA_DE_TRANSICAO: ok`):
  - ninguém cadastra profissional em **nenhum** estabelecimento;
  - ninguém conclui atendimento nos estabelecimentos **com comissões**.
  - Combine com cada dono antes. **Sem acordo com todos, não comece.**
- **Rollback não é recuperação equivalente:**
  - a API `92cc6ae` sobre o schema 16 **ignora "Recebe comissão" desligado**:
    ensaiado, apurou R$ 15,00 de profissional desligado;
  - a `2656f69` não apura nada, e conclusões feitas nela nunca são apuradas.
- **Se for preciso voltar a API,** combine o mesmo bloqueio de conclusões e
  cadastros enquanto a API anterior estiver no ar. Depois, audite o período
  com a consulta da janela. Ver "Voltar a API com o schema 16" no runbook.
- **Nunca:**
  - `migration:revert`;
  - restaurar backup por cima do piloto;
  - apagar apurações, configurações ou regras.
- **Corrigir para frente** é o caminho preferido.

## Comandos para retomar em casa (sem credenciais, sem operação real)

```powershell
# Buscar as branches
git -C C:\Projetos\Agenda-Cloud fetch origin

# Revisão: worktree do #99 (inclui o #98 por baixo)
git -C C:\Projetos\Agenda-Cloud worktree add C:\Projetos\Agenda-Cloud-revisao-99 origin/ops/kit-regra-geral-comissoes --detach
git -C C:\Projetos\Agenda-Cloud-revisao-99 log --oneline origin/integration/nestjs-typeorm-frontend..HEAD

# Kit da 15: worktree limpa no SHA próprio, com dependências próprias
git -C C:\Projetos\Agenda-Cloud worktree add --detach C:\Projetos\Agenda-Cloud-publicacao-15 92cc6ae99856ce43c019f25125bd4140cb916133
cd C:\Projetos\Agenda-Cloud-publicacao-15\backend
npm ci
```

A worktree do kit da 16 só é criada depois do merge do #99 (C16), como diz o
runbook. Os lançadores pedem a URL do piloto num prompt oculto; ela nunca vai
para arquivo, histórico ou comando.

## Melhoria futura em standby (não implementar agora)

**Chat de ajuda no canto do Agenda-Cloud:**

- inicialmente só para o DONO do estabelecimento;
- apenas explicativo: não executa ações;
- quando não resolver, oferece contato por e-mail ou celular;
- antes de escolher fornecedor, avaliar opção gratuita e limites.

Começa em Planejamento quando for retomado.

## Preferências de trabalho combinadas

- **Regra de negócio vaga:** perguntar antes, com exemplos concretos.
- **Tarefas novas relevantes:** começam em Planejamento e só são implementadas
  depois do alinhamento.
- **Esforço e `/fast`:** sempre informar o esforço recomendado e se `/fast`
  deve ser usado. Normalmente OFF.
- **Comissão fixa:** é por serviço realizado (cada item concluído), não por
  atendimento.
- **Backups:** reais ficam para o PC de casa.
