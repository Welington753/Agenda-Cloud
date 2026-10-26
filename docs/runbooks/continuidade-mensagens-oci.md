# Continuidade: mensagens (PR #67) e avaliação da OCI

Checkpoint de 26/10/2026, feito no PC de casa para retomar no PC do trabalho.
Não houve merge, deploy, conexão a banco real, configuração externa nem
criação de recurso na OCI.

## Referências no remoto

Conferidas com `git fetch` neste checkpoint. Nenhuma tinha avançado.

| Branch | SHA | Situação |
| --- | --- | --- |
| `feat/mensagens-convite-remarcacao` | `9088b59d4822b6b7015117819225867792a55d1c` | PR #67, aberto, sem merge |
| `docs/avaliacao-oci` | esta nota (antes dela, `82e7cce5111697e68a0f3c19597f219ed066f9dd`) | só documentação, sem PR |
| `integration/nestjs-typeorm-frontend` | `f37cbc9947806d12d6705cd812e8043fcbcace67` | sem mudança |
| `reserva/api-cadastro-fechado` | `5fe816626b7e891099f0c08ae8b309e1130234f9` | **nunca mesclar na integration** |

## PR #67: mensagens

- **Pronto, sem merge.** SHA final `9088b59d4822b6b7015117819225867792a55d1c`.
- CI: o check "auth real e serviços reais (navegador + API) contra PostgreSQL
  descartável" passou nesse SHA (GitHub Actions, run `40259617190`, 7m07s).
  É o único check do workflow e inclui as suítes `contas`, `whatsapp` e
  `agendamento-publico`.
- Conteúdo:
  - e-mails de convite, reenvio e redefinição de senha pela administração;
  - texto do WhatsApp "Combinar outro horário" ("Aqui é a equipe de ...");
  - plano dos próximos lotes em `docs/plans/mensagens-e-proximos-lotes.md`.
- **Muda o runtime da API e do web.** Sem migration e sem variável nova.
- **Condição para o merge:** confirmar no painel do Render que *Settings →
  Auto-Deploy* está **Off** em `agenda-cloud-piloto-api` **e** em
  `agenda-cloud-piloto-web`, ou ter uma autorização explícita de
  publicação.
  - O histórico de deployments do GitHub **não comprova** a configuração
    atual.
  - `render.yaml` declara `autoDeployTrigger: "off"`, mas o merge de
    `9847c6a`, que não mudou `render.yaml`, foi seguido de deploy em cerca de
    4 minutos. O painel pode estar diferente do arquivo.
  - Nenhum PC tinha acesso ao Render por CLI ou API nesta tarefa.

## Piloto

- O último runtime confirmado é `f37cbc9`. Isso vem de verificações
  anteriores (nota `continuidade-publicacao-contas.md`); **não houve nova
  verificação do Render neste checkpoint**.
- O banco do piloto tem 7 migrations. **`AccountsAdministration1792800000000`
  já foi aplicada e não deve ser repetida.**
- O usuário já testou no piloto o e-mail pelo Brevo (convite recebido,
  senha definida, acesso ao estabelecimento) e a notificação no iPhone.

## Avaliação da OCI

- Documento: `docs/plans/avaliacao-oci.md`, nesta branch.
- **Nenhum recurso OCI foi criado.** Nenhuma conta, cartão, DNS, Render ou
  Brevo foi tocado.
- Proposta: **ensaiar** web e API numa VM da OCI, mantendo Neon e Brevo, sem
  substituir o piloto antes de validar.
- Os testes locais foram em **Windows x64**: medição de memória, proxy na
  mesma origem, reinício da API e do Next, backup e restauração em banco
  descartável. Ainda **não foram comprovados**:
  - compatibilidade e comportamento em Linux ARM64;
  - `systemd` e `reboot`;
  - consumo de memória numa VM de 2 OCPUs.
- O usuário não conhece a OCI e precisa de orientação passo a passo,
  começando por:
  1. criação da conta;
  2. escolha da região de origem (definitiva; perto do Neon do piloto);
  3. identificação dos recursos Always Free e como não sair deles (o painel
     marca shapes e serviços "Always Free-eligible").
- Ainda **não decidido:** domínio próprio, mudança de hospedagem, conta paga.

## Financeiro e estoque

Continuam só no plano `docs/plans/mensagens-e-proximos-lotes.md` (lotes B, C
e D). Nada foi implementado.

## O que existe só no PC de casa

Fora do Git, de propósito. Nada disso foi copiado para o repositório.

- `C:\Users\wwlui\AgendaCloud-secrets\agenda-cloud-piloto-web-push-vapid.env`:
  o par VAPID do piloto (segredo). Também precisa estar no gerenciador de
  senhas. Se a VM vier a substituir o Render, este par é necessário.
- `C:\Users\wwlui\AgendaCloud-backups\`: dumps do piloto anteriores às
  migrations de notificações e WebPush (21 e 22/10/2026), com contagens.
  Contêm dados reais; mova só por meio seguro.
- Pasta temporária da sessão do Claude (scratchpad): capturas dos e-mails
  com o link coberto, scripts de medição e de reinício. Não são necessárias:
  as conclusões estão em `avaliacao-oci.md` e as capturas se refazem pelas
  suítes de navegador.
- O stash `stash@{0}` (`WIP on fix/cancel-stale-confirmation`) é antigo e
  não pertence a esta tarefa. Preservado.

## Retomar no PC do trabalho

```powershell
cd C:\Projetos\Agenda-Cloud
git status                      # pare se houver alterações locais
git stash list; git worktree list
git fetch origin
git switch docs/avaliacao-oci
git merge --ff-only origin/docs/avaliacao-oci
git rev-parse origin/feat/mensagens-convite-remarcacao   # 9088b59d...
git rev-parse origin/integration/nestjs-typeorm-frontend # f37cbc9...
gh pr view 67 --json state,headRefOid,statusCheckRollup
```

Se a branch não existir localmente, `git switch` cria a partir do remoto. Se
o `--ff-only` recusar, pare e compare antes de qualquer outra ação.

Próximos passos, nesta ordem:

1. Usuário: confirmar o Auto-Deploy dos dois serviços no painel do Render.
   Se estiver Off, o merge normal do #67 pode seguir com os checks verdes.
2. Usuário: conferir, no painel do Neon (sem conectar), a região e a versão
   do PostgreSQL do piloto.
3. Claude: guiar o cadastro na OCI passo a passo. A partir daí, seguir as
   etapas 1 a 4 do roteiro de `avaliacao-oci.md`, numa VM vazia e com banco
   descartável.
