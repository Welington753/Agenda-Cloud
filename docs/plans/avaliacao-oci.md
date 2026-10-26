# Avaliação: hospedar o Agenda Cloud na OCI (Always Free)

Avaliação de 26/10/2026, feita no código de `f37cbc9` (o runtime do piloto) e
na documentação oficial da Oracle consultada nessa data. **Não autoriza
migração, cadastro de cartão, criação de recursos, mudança de DNS, Render ou
Brevo.** O piloto no Render continua como está durante todo o ensaio.

Proposta avaliada: Next.js e NestJS numa VM da OCI, PostgreSQL no Neon,
e-mail pelo Brevo.

Resumo: a VM Arm do Always Free comporta o sistema com folga, e o código não
depende de nada específico do Render que não tenha substituto. As incertezas
reais são de **conta e capacidade**, não de código:

- a criação da VM pode falhar por falta de capacidade;
- uma VM com o tráfego do piloto tende a cair no critério de **ociosidade**
  da Oracle e pode ser recuperada (parada);
- não há SLA nem suporte documentados para o Always Free;
- é preciso um domínio próprio para ter HTTPS e não quebrar links de novo
  numa mudança futura.

## 1. O que a OCI oferece

Fontes: [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
e [Oracle Cloud Infrastructure Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm).
Os números mudam com o tempo; confira de novo antes do ensaio.

### Always Free (não expira) e Free Trial (temporário)

| | Always Free | Free Trial |
| --- | --- | --- |
| Duração | Sem prazo de expiração | US$ 300 em créditos, válidos por até 30 dias |
| Ao terminar | Os recursos Always Free continuam | Recursos pagos criados com os créditos são recuperados pela Oracle, a menos que a conta seja convertida em paga |
| Cobrança | Nenhuma | O cartão é pedido no cadastro, mas a Oracle diz que não cobra sem a conversão da conta |

Regra que afeta o ensaio: se, ao fim do trial, houver mais instâncias Ampere
A1 do que o Always Free permite, **todas** as instâncias A1 são desativadas e
apagadas depois de 30 dias. Portanto, o ensaio deve usar só o tamanho Always
Free desde o primeiro dia, sem crédito nenhum.

### Limites relevantes do Always Free

| Recurso | Limite documentado |
| --- | --- |
| VM Arm (`VM.Standard.A1.Flex`) | 1.500 OCPU-hora e 9.000 GB-hora por mês, o que equivale a **2 OCPUs e 12 GB**, numa VM ou em duas de 1 OCPU |
| VM AMD (`VM.Standard.E2.1.Micro`) | até 2 VMs, cada uma com 1/8 de OCPU, 1 GB de memória e até 50 Mbps |
| Região | Compute só na **região de origem**, escolhida no cadastro e que não muda depois |
| Disco | 200 GB no total (o boot volume mínimo é de 47 a 50 GB; a página traz os dois números) e 5 backups de volume |
| Object Storage | 20 GB (combinados entre as camadas) e 50.000 requisições por mês, depois do trial |
| Saída de dados | 10 TB por mês |
| Monitoring / Notifications | 500 milhões de pontos ingeridos; 1 milhão de notificações HTTPS e 1.000 e-mails por mês |
| Vault | 150 segredos Always Free; chaves protegidas por software grátis |
| Load balancer | um flexível de 10 Mbps (não é necessário aqui) |

Dentro desses limites, o custo é zero. Antigamente o limite da A1 era maior
(4 OCPUs e 24 GB); a página atual diz 2 OCPUs e 12 GB.

### Capacidade e ociosidade

- **Capacidade:** "out of host capacity" ao criar a VM significa falta
  temporária do shape Always Free na região. A Oracle sugere tentar outro
  availability domain, esperar ou converter a conta em paga. **Não há
  garantia de conseguir criar a VM.**
- **Ociosidade:** a Oracle considera ociosa a VM em que, durante 7 dias, o
  percentil 95 da CPU fica abaixo de 20%, a rede abaixo de 20% e, só na A1, a
  memória abaixo de 20%. VMs ociosas "may be reclaimed".
  - O piloto, com o tráfego atual, usa cerca de 0,3 GB de 12 GB (2 a 3%) e
    quase nada de CPU. Ele **tende a ser classificado como ocioso**.
  - Relatos da comunidade dizem que a VM é **parada** (não apagada) após
    aviso, e que contas convertidas em pagas não sofrem isso. **Nenhum dos
    dois aparece na documentação oficial consultada.**
  - Tráfego artificial para fugir da regra não é opção.
- **SLA e suporte:** a página do Always Free não fala de SLA nem de suporte.
  Trate como serviço sem garantia.
- **Conta inativa:** um trecho do FAQ da Oracle visto em busca diz que contas
  sem uso por 30 dias podem ser consideradas abandonadas. A página
  (`oracle.com/cloud/free/faq/`) recusou o acesso automatizado, então isso não
  foi conferido no texto oficial.

## 2. O que o projeto exige, conferido no código

Legenda: **testado** = executado nesta avaliação (Windows x64, Node 24.19,
PostgreSQL 17 descartável com TLS `verify-full`); **lido** = conferido no
código; **VM** = só uma VM real comprova.

### Linux ARM64 e dependências nativas (lido; VM)

- Node `>=24 <25` nos dois projetos. O Node publica binários oficiais para
  Linux ARM64.
- Os lockfiles já trazem as variantes `linux-arm64` (glibc e musl) de tudo
  que é nativo:
  - no frontend: `@next/swc`, `sharp`/`libvips`, `@tailwindcss/oxide`,
    `lightningcss`, `esbuild`;
  - no backend: `rolldown`, `oxlint`, `lightningcss`;
  - `argon2` 0.45.1 inclui `prebuilds/linux-arm64` (`armv8.glibc` e
    `armv8.musl`): não compila nada na instalação.
- `npm ci` na raiz roda o script de instalação do Prisma, que baixa o motor
  da plataforma (inclui ARM64) da internet. O Prisma só serve aos testes
  `*.db.test.ts` legados, mas o download acontece mesmo assim; a VM precisa de
  saída para a internet durante a instalação.
- **Um teste em x64 não comprova ARM64.** A primeira etapa do ensaio é
  `npm ci`, build e testes unitários na própria VM.

### Memória: build e operação (testado em x64, só indicativo)

| Etapa | Pico medido |
| --- | --- |
| `nest build` | cerca de 540 MB, 7 s |
| `next build` (`NEXT_PUBLIC_API_URL=/agenda_api`) | cerca de 1,6 GB, 22 s, com 12 núcleos (o Next usa mais workers com mais núcleos) |
| API em repouso / após 400 requisições | cerca de 125 MB / 100 MB |
| Next (`next start`) em repouso / após 400 requisições | cerca de 100 MB / 110 MB |
| Suíte do proxy inteira (API, Next, bordas, executor) | cerca de 420 MB |

Conclusões:

- A **A1 com 12 GB** comporta build e operação com folga.
- A **E2.1.Micro (1 GB)** não comporta o build do Next. Também não comporta
  os dois processos com folga, então não serve.
- No ensaio, meça na VM: o pico do build com 2 OCPUs e o consumo depois de
  uma semana de operação.

### HTTPS, mesma origem, cookies, CSRF, IP do cliente e limitadores (testado e lido)

Topologia proposta, igual à do teste `test:browser:proxy`:

```
navegador ──HTTPS──> Caddy (443, certificado Let's Encrypt)
                       └─HTTP──> Next.js 127.0.0.1:3000 (/agenda_api)
                                   └─HTTP──> NestJS 127.0.0.1:3001
```

- `test:browser:proxy`, com a borda HTTPS local
  (`tests/browser/support/borda-https.mjs`), passou em 4 de 5 casos:
  - `Origin` de outro site recusado pelo proxy antes da API;
  - cabeçalhos de IP forjados não escapam do limite;
  - chamada direta à API com `X-Agenda-Client-IP` forjado, sem o segredo, não
    escapa;
  - chamada direta pela borda com cabeçalhos forjados não escapa.
- O caso de convite, login e sessão para em "Conectando ao servidor…" **só no
  Windows**. A mesma falha já ocorria na base `20e3fdc` (registro em
  `administracao-real-e-financeiro.md`), e o caso passa no CI Linux, inclusive
  nos checks do PR #67.
- **IP do cliente:** o proxy do Next só repassa o IP do cliente a partir de
  `CF-Connecting-IP` (`src/lib/api/proxy.ts`). Sem a borda do Render, existem
  duas saídas:
  1. o Caddy **sobrescreve** `CF-Connecting-IP` com o endereço da conexão
     (`header_up CF-Connecting-IP {remote_host}`). É exatamente o que a borda
     do teste faz, e não exige mudança de código. Os dois serviços usam
     `CLIENT_IP_SOURCE=cf-connecting-ip` e o mesmo `API_PROXY_SECRET`;
  2. um PR pequeno com uma fonte de nome neutro (por exemplo,
     `proxy-header`). É mais claro, mas é código novo.

  Com `socket` e sem o cabeçalho, todos os clientes dividiriam um limite só,
  a falha já descrita no runbook do Render.
- **Exposição:** a API escuta em `HOST=127.0.0.1` (variável já existente em
  `main.ts`) e o Next com `-H 127.0.0.1`. Só o Caddy abre 80 e 443, na
  security list da VCN e no firewall da VM. Com isso, chamadas diretas à API
  pela internet deixam de existir.
- **Cookies:** com `NODE_ENV=production` o cookie sai `Secure`,
  `SameSite=Lax` e `HttpOnly`, e `FRONTEND_URL` precisa ser HTTPS
  (`env.validation.ts`). O proxy exige `APP_PUBLIC_ORIGIN` como origem exata.
  Fora do Render, `RENDER` não existe, então o proxy aceita destino `http:`,
  o que é correto para `127.0.0.1`. Mas isso também tira a exigência de
  segredo: é preciso definir `API_PROXY_SECRET` assim mesmo, ou o IP do
  cliente não chega à API.
- **Limitadores:** ficam em memória, um processo por serviço. Na VM, rode
  **uma instância** de cada; nada de modo cluster.

### Reinício automático (testado em parte; VM)

- Testado:
  - com a API parada, `/agenda_api/auth/me` devolve **502**, nunca 401: a
    falha de rede não vira "não autenticado";
  - depois de reiniciar a API e, depois, o Next, a mesma sessão continua
    válida (`200`), porque fica no banco.
- VM: units `systemd` com `Restart=always`, habilitadas no boot, para API,
  Next e Caddy. Ensaiar a queda de processo (`kill -9`) e o `reboot` da VM.
- Como a VM pode ser parada por ociosidade ou por capacidade, ela não deve
  guardar estado. Tudo que importa fica no Neon; configuração e segredos se
  recriam por script e cofre.

### Neon com TLS verificado (lido; VM)

- `runtime-data-source.ts` usa `ssl: { rejectUnauthorized: true }`, nunca
  desligado. O certificado do Neon é de CA pública, então o Node valida com o
  repositório padrão, sem `NODE_EXTRA_CA_CERTS`.
- **Região:** cada requisição faz várias consultas. A VM deve ficar perto do
  Neon do piloto (o Render está em `virginia`), não perto dos usuários.
  Escolher São Paulo como região de origem somaria a distância até o Neon a
  cada consulta. A região de origem é escolhida no cadastro e não muda depois:
  confira a região do Neon antes do cadastro.
- `DATABASE_URL` (com pooling) e `DIRECT_URL` continuam iguais.
- Ninguém deve aplicar migrations a partir da VM durante o ensaio. A
  `AccountsAdministration` já está aplicada e não se repete.

### Brevo (lido na documentação do Brevo)

- O remetente e a chave continuam os mesmos. Na VM, as variáveis vão no
  arquivo de ambiente do serviço, só legível pelo usuário do serviço, nunca no
  Git.
- O Brevo pode **bloquear IPs desconhecidos** por chave de API. Novos IPs
  são aceitos automaticamente até a chave passar 30 dias sem IP novo; depois
  disso, chamadas de IP desconhecido são recusadas, com e-mail de aviso.
  - A chave atual já é usada pelo Render, então o IP da VM pode ser recusado.
  - Antes do ensaio, quem administra o Brevo confere em *Settings → Security →
    Authorized IPs* se o bloqueio está ativo e autoriza o IP público da VM.
  - O endereço de saída real pode ser diferente do IP público; confira na VM.
- Para o ensaio, o mais seguro é uma **chave separada**, revogável sem
  afetar o piloto. A sua criação também é uma mudança no Brevo, que precisa de
  autorização.

### Push: VAPID e iPhone (lido; aparelho real)

- Mantenha o **mesmo par VAPID**: `WEB_PUSH_VAPID_PUBLIC_KEY`,
  `WEB_PUSH_VAPID_PRIVATE_KEY` e `WEB_PUSH_SUBJECT`. As assinaturas gravadas
  em `push_subscriptions` estão assinadas pela chave pública. Trocar o par
  invalida todas.
- Uma inscrição pertence à **origem** que registrou o service worker
  (`/sw.js`, escopo `/`). No iPhone, o push só funciona no app adicionado à
  Tela de Início a partir daquela origem.
  - Endereço novo: cada pessoa precisa abrir o endereço novo, adicioná-lo à
    Tela de Início e ativar as notificações de novo.
  - O ícone antigo continua apontando para o Render.
  - As linhas antigas continuam no banco e, enquanto o Render estiver no ar,
    os avisos continuam funcionando por ele.
- Ensaio: com um domínio de teste, inscreva um aparelho, confira o aviso de
  nova solicitação e o cancelamento da inscrição. Não use os aparelhos do
  piloto.

### Links públicos, convites e redefinição (lido)

- Os links de convite e de redefinição usam `FRONTEND_URL`. Os links já
  enviados apontam para o endereço antigo e valem 24 horas; durante a
  transição, o Render precisa continuar no ar ao menos por esse tempo.
- O link público de agendamento (`/agendar/<slug>`) já foi divulgado pelos
  estabelecimentos com o domínio `onrender.com`. Mudar de host sem domínio
  próprio quebra esses links, e os do próximo host também.
- **Recomendação:** antes de qualquer mudança de host, um domínio próprio
  (por exemplo, `.com.br` no Registro.br), apontado primeiro para o Render.
  Assim, mudar de host passa a ser só trocar o DNS, e o domínio resolve também
  o HTTPS da VM (o Let's Encrypt exige nome). **A compra e a mudança de DNS
  precisam de decisão sua.**

### Backup, restauração e monitoramento (testado em parte; VM)

- Testado:
  - `pg_dump -Fc` do banco descartável (com dados das suítes), restauração
    num banco novo e comparação: 38 tabelas com contagens iguais e 7
    migrations, em 2 segundos;
  - `pg_dump` precisa ser de versão igual ou maior que a do servidor. Confira
    a versão do Neon.
- Proposta para a VM:
  - backup diário com `pg_dump` pela `DIRECT_URL` (só leitura), criptografado
    antes de sair da VM (por exemplo, `age` com chave pública; a privada fora
    da VM);
  - envio a um bucket do Object Storage com retenção, ou a outro provedor.
    Com isso, o backup sai dos PCs, mas fica na mesma conta da Oracle: decida
    se isso basta;
  - restauração ensaiada em banco descartável a cada mês, conferindo contagens
    como acima;
  - o Neon também tem restauração própria por janela de tempo. Confira a do
    plano atual.
- Monitoramento:
  - OCI Monitoring e Notifications (incluídos no Always Free), com alarmes de
    VM parada, CPU, disco e memória;
  - verificação HTTP externa de `/login` e de `/` da API, com alerta por
    e-mail. Uma verificação a cada vários minutos é monitoramento, não
    tráfego para fugir da ociosidade; ela não muda o enquadramento da VM;
  - `journald` com rotação para os logs da aplicação. Os logs já não levam
    token nem conteúdo de e-mail.

## 3. Recursos e custos

| Item | Custo esperado | Observação |
| --- | --- | --- |
| VM A1, 2 OCPUs e 12 GB, boot de 50 GB | R$ 0 dentro do Always Free | Sujeita a capacidade e ociosidade |
| Object Storage (backups até 20 GB) | R$ 0 | O piloto atual gera dumps de centenas de KB |
| Monitoring e Notifications | R$ 0 | Dentro dos limites acima |
| Saída de dados | R$ 0 até 10 TB/mês | |
| Neon e Brevo | Os planos atuais, sem mudança | |
| Domínio próprio | cerca de R$ 40 por ano (`.com.br`, valor a conferir no Registro.br) | Recomendado em qualquer host |
| Conta paga (Pay As You Go), se decidida | R$ 0 dentro dos limites; cobra só o que passar | Exige cartão. Talvez reduza o risco de ociosidade, mas **sem confirmação oficial**. Precisa de alarme de orçamento |

Não há custo de licença. O custo real é o **tempo de operação**: atualizar o
sistema operacional, renovar certificados (o Caddy faz isso sozinho) e
responder a alarmes, que no Render ficam por conta da plataforma.

## 4. Roteiro de ensaio

Pré-requisitos, todos com decisão sua:

1. conta OCI criada, região de origem perto do Neon;
2. domínio de teste (por exemplo, `ensaio.<domínio>`);
3. banco **descartável** no Neon ou um PostgreSQL na própria VM: o ensaio não
   usa o banco do piloto;
4. chave do Brevo própria do ensaio, ou o envio desligado
   (`EMAIL_PROVIDER=none`) com a caixa local dos testes;
5. par VAPID **de ensaio**, nunca o do piloto. O par do piloto só vai para a
   VM se ela vier a substituir o Render.

Etapas e critérios de aprovação:

| # | Etapa | Aprovado quando |
| --- | --- | --- |
| 1 | Criar a VM A1 de 2 OCPUs e 12 GB, Ubuntu LTS ARM64, só 22, 80 e 443 abertos; SSH só por chave | VM ativa, sem crédito de trial em uso |
| 2 | Node 24 ARM64, `npm ci` e build nos dois projetos | Sem compilação nativa falhando; `npm test` nos dois projetos verde na VM; pico do build medido |
| 3 | Migrations no banco descartável, pela `DIRECT_URL` com TLS verificado | 7 migrations, `typeorm_migrations` conferida |
| 4 | Units `systemd` para API e Next em `127.0.0.1`; Caddy com HTTPS e `header_up CF-Connecting-IP {remote_host}` | `curl https://ensaio.../login` 200; porta 3001 inacessível de fora |
| 5 | Login | Login e logout pelo domínio; cookie `Secure`/`HttpOnly`; `Origin` de outro site recusado |
| 6 | Convite | Convite criado; e-mail recebido (chave de ensaio) ou capturado; link no domínio de ensaio; aceite com senha; link não reutilizável |
| 7 | Agendamento | Pedido público, confirmação e remarcação; WhatsApp só como link |
| 8 | Disputa de horário | Dois pedidos simultâneos no mesmo horário: um aceito e um recusado (exclusion constraint), sem reserva dupla |
| 9 | Limitadores | Duas origens de IP diferentes têm limites separados; cabeçalhos forjados não escapam |
| 10 | Notificações | Aparelho de teste adicionado à Tela de Início, inscrito; aviso de nova solicitação recebido; cancelamento funciona |
| 11 | Recuperação | `kill -9` da API e do Next: voltam sozinhos em menos de 1 minuto, com a sessão mantida; `reboot` da VM: tudo volta sem intervenção |
| 12 | Backup e restauração | Backup automático criptografado no bucket; restauração em banco novo com contagens iguais; tempo registrado |
| 13 | Monitoramento | Alarme recebido ao parar a VM e ao derrubar a API |
| 14 | Observação de 14 dias | Memória e CPU registradas; nenhum aviso de ociosidade, ou o aviso registrado com a reação da Oracle |

Interrompa o ensaio, sem tentar contornar, se ocorrer qualquer um destes:

- falta de capacidade persistente;
- pedido de cobrança;
- aviso de ociosidade sem saída oficial.

### Abandonar o ensaio

O piloto não depende de nada criado no ensaio:

1. pare e apague a VM, o bucket e os alarmes na OCI;
2. revogue a chave do Brevo de ensaio e o par VAPID de ensaio;
3. remova o registro DNS do subdomínio de ensaio;
4. apague o banco descartável do ensaio.

Render, Neon do piloto, Brevo do piloto e DNS de produção não mudam em
nenhuma etapa. O piloto continua funcionando o tempo todo.

## 5. Decisões e próximo passo

Decisões suas antes do ensaio:

1. Comprar um domínio próprio e apontá-lo primeiro para o Render. Vale para
   qualquer host, e é o passo de menor risco.
2. Criar a conta OCI (cadastro exige cartão, sem cobrança sem conversão) e
   escolher a região de origem perto do Neon.
3. Aceitar o risco de ociosidade numa conta só Always Free, ou converter para
   Pay As You Go com alarme de orçamento.
4. Chave do Brevo separada para o ensaio e conferência do bloqueio de IPs.
5. Onde ficam os backups (bucket na mesma conta da Oracle, ou fora dela).

Próximo passo concreto: conferir a região do Neon do piloto e a versão do
PostgreSQL (no painel do Neon, sem conectar ao banco). Com isso decidido,
criar a conta OCI e executar as etapas 1 a 4 numa VM vazia, com banco
descartável.
