# Continuidade: publicação da gestão de contas no piloto

Checkpoint de 23/10/2026, feito no PC do trabalho, para retomar em outro
computador. O roteiro completo está em `publicacao-contas-piloto.md`.

## Feito no piloto

**A migration `AccountsAdministration1792800000000` já foi aplicada e
conferida.** Não aplique de novo.

| Etapa | Resultado |
| --- | --- |
| Commit de onde a operação rodou | `f37cbc9947806d12d6705cd812e8043fcbcace67` |
| `preparar` | estado `before` confirmado (6 migrations, 0/40), backup feito |
| `restauracao` | 37 tabelas com contagens e md5 iguais; migration ensaiada na cópia |
| `aplicar` | às 18:05:42 UTC: `aplicada_e_conferida`, 7 migrations, 40/40, `RESULT: SUCCESS` |

Repetir a fase `aplicar` só daria `ERR_ESTADO_ANTES_DIVERGENTE`. Ela não
grava nada nesse caso, mas não há motivo para rodá-la.

## Pendente

1. **Publicar a API e o web em `f37cbc9`.** Nada foi publicado no Render. A
   API que está no ar (`35f4713`) funciona com o schema novo, mas ainda aceita
   o cadastro público.
2. **Configurar o e-mail**, quando decidir (seção "E-mail" do runbook). Sem
   ele, convites ficam como "envio não configurado".

## API de reserva (só para recuperação)

- **Branch e SHA:** `reserva/api-cadastro-fechado`,
  `5fe816626b7e891099f0c08ae8b309e1130234f9`.
- **O que é:** `35f4713` sem a rota `POST /auth/register`. O cadastro dá 404
  direto e pelo proxy; o resto é igual à API publicada hoje.
- **Nunca mesclar na integration.** Ela existe só para ser publicada no
  serviço da API se a API nova precisar sair do ar.
- **Testes:** 1.365 unitários e 117 HTTP e2e. Contra um PostgreSQL descartável
  com as 7 migrations e TLS verificado:
  - cadastro 404 sem gravar nada;
  - login e sessão funcionando, inclusive sessões criadas pela API nova;
  - conta bloqueada recusada;
  - restrição `DENIED` respeitada;
  - agenda funcionando;
  - web novo no navegador: as telas da administração nova ficam indisponíveis.
- **Limitações:**
  - não se sabe se o Render aceita deploy por SHA de outra branch; o plano B
    é trocar a branch do serviço temporariamente;
  - o teste no navegador foi em HTTP local;
  - o CI não rodou nessa branch.
- **Não use o botão Rollback da API:** ele volta para `35f4713`, com o
  cadastro aberto.

Detalhes, tabela do que fica indisponível e procedimento em
`publicacao-contas-piloto.md`, seção "API de reserva".

## Fica só no PC do trabalho (fora do Git, de propósito)

**Pasta de operações** `C:\Users\User\AgendaCloud-operacoes`:

- `contas-preparar-2026-10-23T17-49-14-052Z`: dump, `manifesto.json` e
  `restauracao-conferida.json`;
- `contas-aplicar-2026-10-23T17-59-40-736Z`: dump e `manifesto.json`. É o
  ponto de recuperação anterior à migration, 18:01:11 UTC;
- `operacoes.jsonl`: registro das operações;
- os backups `master-owner-*` da promoção;
- `promover-master-owner.mjs`: cópia antiga do script, com os Endpoint IDs
  fixos.

Por que não vão para o Git: os dumps têm dados reais e hashes de senha; os
manifestos e o registro têm o Endpoint ID do piloto. Copie para outro
computador só por meio seguro e fora de pastas sincronizadas.

**Worktrees locais:**

- `C:\Projetos\Agenda-Cloud-publicacao`: detached em `f37cbc9`, sem
  alterações;
- `C:\Projetos\Agenda-Cloud-reserva`: `reserva/api-cadastro-fechado`, já
  enviada ao remoto;
- `C:\Projetos\Agenda-Cloud-promocao`: `chore/continuidade-promocao-master-owner`,
  já no remoto.

Nenhum deles tem trabalho que não esteja no remoto.

## Retomar em casa

Nenhum passo abaixo precisa de banco nem da pasta de operações.

1. Atualize o clone e confira os SHAs:
   ```powershell
   git fetch origin
   git rev-parse origin/integration/nestjs-typeorm-frontend   # f37cbc9947806d12d6705cd812e8043fcbcace67
   git rev-parse origin/reserva/api-cadastro-fechado          # 5fe816626b7e891099f0c08ae8b309e1130234f9
   git switch docs/recuperacao-api-reserva                    # esta nota e o runbook atualizado
   ```
2. **Publique a API.** No Render, serviço `agenda-cloud-piloto-api`, use
   **Manual Deploy → Deploy a specific commit →
   `f37cbc9947806d12d6705cd812e8043fcbcace67`**. Espere ficar Live e confira:
   - `GET $WEB/agenda_api/auth/me` deve dar `401`;
   - `POST $WEB/agenda_api/auth/register` com `Origin: $WEB` deve dar `404`.
3. **Publique o web.** No serviço `agenda-cloud-piloto-web`, use o mesmo SHA.
   Confira:
   - `/login` sem "Criar conta";
   - `/cadastro` sem formulário;
   - entrando com `wwluiz90@gmail.com`, as abas da Administração aparecem.
4. **Se a API nova falhar:** publique a reserva `5fe8166` (seção "API de
   reserva"). Não use Rollback na API.
5. **Depois de publicado:**
   - decida o e-mail (Brevo, sem domínio próprio: entrega incerta; liberar os
     IPs de saída do Render no Brevo);
   - abra um PR desta branch de documentação para a integration. É só
     documentação; não mescle a branch da reserva.

Para uma conferência só de leitura do banco em casa (fase `conferir`), você
precisa de três coisas:

- os Endpoint IDs, que estão no gerenciador de senhas;
- a URL direta do piloto;
- uma pasta limpa em `f37cbc9` com `npm ci` (passo 0 do runbook).

Ela não é necessária para publicar.
