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

**Próximo passo:** PR para a integração, CI verde, merge e publicação de API e web no mesmo SHA (sem migration).
