# Lote N: navegação do celular com rolagem horizontal

Pedido de 19/11/2026. Só web, sem migration e sem mudança na API. Independe do lote de clientes (`clientes-ficha-e-duplicados.md`).

## Objetivo

No celular, a barra inferior de `/conta` mostrava no máximo quatro áreas. As outras ficavam em "Mais áreas", no menu da conta (avatar). Agora a barra mostra **todas** as áreas liberadas e rola na horizontal só dentro dela. O avatar fica só com as ações da conta.

## Regras

- **Fonte única:** `itensDaNavegacao` e `gruposDaNavegacao` (`src/lib/conta/navegacao.ts`), com papel, permissões (`areas`) e adicionais como hoje.
  - A flag `noCelular` e a regra "três primeiros do gerente na barra" saíram.
  - A barra segue a ordem dos grupos.
- **Faixa** (`src/components/conta/faixa-de-areas.tsx`):
  - rola só dentro da barra (`overflow-x-auto`, `overscroll-x-contain`), sem rolagem lateral da página;
  - a área atual vem para o centro a cada troca de página (`scrollTo` no próprio contêiner);
  - degradê e seta nas pontas com mais áreas, só visuais (`aria-hidden`);
  - todos os links ficam no DOM, na ordem do Tab; o foco rola a faixa.
- **Itens** (`link-navegacao.tsx`):
  - largura pelo rótulo, com mínimo de 4,5rem;
  - o rótulo quebra só entre palavras, em até duas linhas;
  - poucas áreas dividem a largura;
  - um traço fino separa os grupos.
  - Solicitações e Recebimentos ganharam ícone próprio.
- **Menu da conta** (`menu-conta.tsx`): sem "Mais áreas". Ficam notificações, aparência, Configurações, Perfil e segurança, Sair.
- Os tokens de cor (`--color-chrome-*`) são os mesmos nos quatro temas; nenhuma classe por tema.

## Testes

- Unidade: `src/lib/conta/navegacao.test.ts` e `papel.test.ts`. Celular e computador usam a mesma lista, e nenhum item tem marca de "só no menu".
- Navegador:
  - `configuracoes-navegacao-flow.spec.ts`: todas as áreas na faixa, seta, toque de 44 px, área atual inteira à vista depois de cada toque e ao abrir direto uma área do fim, Tab pela faixa inteira, menu da conta sem áreas, "Sair" acima da barra, 390 e 360;
  - `pilot-navigation-flow.spec.ts`, `clients-flow.spec.ts`, `estoque-flow.spec.ts`, `identidade-visual-flow.spec.ts`, `layout-por-tema-flow.spec.ts` (quatro temas).

## Estado e retomada

**19/11/2026:** implementado na branch `feat/navegacao-celular-rolagem`. Suítes locais verdes com PostgreSQL descartável:
- `test:browser:services`: 7;
- `test:browser:clients`: 3;
- `test:browser:layout-temas`: 1;
- `test:browser:estoque`: 1.

Capturas conferidas em 390 e 360.

**19/11/2026, mesclado e publicado.** PR #137 mesclado como `0d8f479`, com CI verde no head `27f4151`. Antes do merge, o CI teve duas correções: folga de 4 px nas pontas da faixa e a suíte do portal, que ainda esperava 4 itens. Nenhum arquivo de `backend/` nem migration; banco do piloto não foi tocado.

Antes da publicação: API e web `live` em `e78c3d1`, fila vazia, Auto-Deploy `off` nos dois serviços.

| Serviço | Deploy | Commit | Início (UTC) | Fim (UTC) | Situação |
|---|---|---|---|---|---|
| API | `dep-dbvkl6bl550s73856vt0` | `0d8f479` | 19:14:33 | 19:15:31 | live |
| web | `dep-dbvklocipgvc73dgklb0` | `0d8f479` | 19:15:45 | 19:18:11 | live |

Conferências depois:
- API: `GET /` 200, `GET /health` 200, log com "Nest application successfully started" e sem aviso de `SchemaReadiness`;
- web: `/`, `/login` e `/conta` 200; o pacote servido em `/conta` contém a faixa nova (`faixa-de-areas`); `/agenda_api/auth/me` sem sessão responde 401 em JSON da API (proxy alcança a API).

**Falta:** teste no celular com sessão real (feito pelo responsável).

**Retorno, se preciso:** API e web voltam juntos a `e78c3d1` (sem migration envolvida).
