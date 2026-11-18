# Tema opcional "Azul e branco"

**Estado (2026-11-18):** o layout novo (menu agrupado do portal e de
`/conta`, Visão geral do portal em cartões e painéis, bordas dos menus) passou
a ser o ÚNICO layout, em todos os temas. A escolha de aparência muda só a
paleta (tokens de `globals.css`); ver "Layout único em todos os temas" no fim
do arquivo. O histórico abaixo descreve a fase em que o arranjo dependia do
tema.

**Registro original:** registrado em 2026-11-17. Primeira versão LOCAL feita em
2026-11-17 na branch `feat/tema-azul-e-branco-portal` (ver "Estado e
retomada"), aguardando a avaliação visual do dono. Nada publicado. Esta tarefa
não altera a fila operacional já planejada (publicação em etapas,
`publicacao-consolidada-b5b2704.md`).

**Referência visual:** [referencias/tema-azul-e-branco-portal.png](referencias/tema-azul-e-branco-portal.png)
(tela "Visão geral" do portal da plataforma). Números e textos da imagem são
ilustrativos; a aplicação continua usando os dados reais.

## Objetivo

Adicionar um tema opcional "Azul e branco", com organização visual inspirada
na imagem, para facilitar a compreensão das telas.

- Preservar os temas atuais e as preferências salvas.
- O novo visual **não** substitui automaticamente a aparência escolhida pelo
  usuário.
- Preservar funcionalidades, URLs, cálculos, avisos e regras de acesso.

## Direção visual

- Fundo branco gelo com azul muito suave.
- Cartões brancos, bordas discretas e sombras leves.
- Azul nos botões principais, links, indicadores e item ativo do menu.
- Títulos em azul-marinho e textos com bom contraste.
- Manter cores próprias para sucesso, alerta e erro.
- Evitar excesso de azul, gradientes fortes e elementos decorativos.

Paleta inicial sugerida, ajustável à referência:

| Uso | Cor |
|---|---|
| Fundo | `#F3F7FC` |
| Cartões | `#FFFFFF` |
| Azul principal | `#2563EB` |
| Títulos | `#172B4D` |
| Texto secundário | `#475569` |
| Bordas | `#D7E3F4` |

## Layout

- Menu lateral claro, organizado por assuntos e com seleção bem visível.
- Cabeçalho com título, explicação curta e ações principais.
- Filtros próximos dos dados que controlam.
- Indicadores principais no início, com números destacados.
- Blocos seguintes organizados por assunto, em duas colunas no computador
  quando fizer sentido.
- No celular, reorganizar os blocos sem apertar textos, esconder ações ou
  criar rolagem horizontal.

## Escopo

1. Primeira referência: portal administrativo (a imagem).
2. Depois: mesma linguagem visual na conta do dono, respeitando os menus e as
   permissões de cada perfil.

## Estado e retomada

**Feito (2026-11-17, só local):**

- Quarta opção de aparência, "Azul e branco" (`data-tema="azul"`), no menu do
  usuário do portal. O padrão continua "Seguir aparelho"; ninguém muda de tema
  sem escolher.
- Tokens em `src/app/globals.css`, válidos só com `data-tema="azul"` e o
  marcador `<MarcadorTemaAzul />` (layout de `/portal/(area)`). Variante
  Tailwind `azul:` com a mesma condição, para ajustes que só o tema azul tem.
- Fora do portal, o valor salvo "azul" aparece como o Claro; o seletor da conta
  mostra a opção marcada e o aviso "Nesta área, Azul e branco ainda aparece
  como Claro".
- Menu do portal agrupado (Gestão, Comercial, Administração) em
  `GRUPOS_SECOES_ADMINISTRACAO` (`src/lib/administracao/rotas.ts`); títulos e
  linhas só no tema azul. Menu do celular rola por dentro quando passa da tela.
- Visão geral: arranjo próprio no tema azul
  (`src/components/administracao/visao-geral-azul.tsx`), com os mesmos dados,
  links e `data-testid`; peças comuns em `visao-geral-pecas.tsx`. Claro e
  Escuro continuam com o arranjo de antes.
- Conferido em banco descartável com dados fictícios: suíte
  `portal-visao-geral` (tema padrão) verde; roteiro local de capturas
  (computador 1440, celular 390 e 360, persistência, foco, alerta, erro,
  seleção, Claro/Escuro/Seguir aparelho).

**Acabamento (2026-11-17, só local), depois da primeira avaliação:**

- Celular: cabeçalho mais baixo, com Atualizar na linha do título (quebra para
  baixo quando falta espaço).
- Alcance: resumo curto (`ESCOPOS[...].resumo`) e a explicação completa em
  "Sobre este filtro" (`<details>`, toque e teclado). Aviso de alcance não
  confirmado continua sempre visível.
- Ordem no HTML = ordem do celular: indicadores, Atenção, Pagamentos,
  Modalidade, lista. No computador a grade só recoloca a Modalidade (sem
  links) à esquerda; a ordem do teclado não muda.
- Cobertura versionada em `tests/browser/portal-visao-geral-flow.spec.ts`
  (`temaAzulEBranco`): escolher, recarregar, números da API, "Sobre este
  filtro" pelo teclado, ordem em 390 e 360 px e volta ao Claro. Sem login extra.

**Validação executada (local, banco descartável, dados fictícios):**

- `tsc` e ESLint dos arquivos alterados sem erros; Vitest de aparência,
  diretório e rotas: 29 testes verdes.
- Suíte `portal-visao-geral` (com o trecho do tema azul em 390 e 360 px): a
  primeira rodada, num banco reaproveitado, falhou em `relatoriosPorPeriodo`
  porque os dados fixos de 2002 da rodada anterior estavam duplicados (total
  dobrado); o trecho do tema azul, que roda antes, passou. Rodada completa em
  banco limpo: verde.
- Roteiro local de capturas (fora do Git): viewports de 1440, 390, 360 e
  320 px. O de 320 px é só uma tela estreita (em 320 px, "Todos" do seletor de
  alcance desce para a segunda linha, sem rolagem lateral); **não** é um teste
  de zoom real de 200% do navegador, que não foi executado.

**Todos os ambientes (2026-11-17, branch `feat/tema-azul-todos-ambientes`, só local):**

- "Azul e branco" passou a valer em toda página adaptável (portal, entrada do
  portal, login, recuperação de senha, cadastro, convite, liberação do 2FA e
  `/conta`) e no agendamento público deste navegador, quando escolhido nele.
  Saíram o marcador `MarcadorTemaAzul`, a volta ao Claro e o aviso "Nesta
  área...". O seletor mostra sempre as quatro opções; o padrão segue
  "Seguir aparelho" e as escolhas salvas continuam valendo.
- Mesmo mecanismo (`data-tema` + `localStorage`), mesmos tokens; só bordas
  `azul:` nos menus brancos (conta, login, entrada do portal, 2FA).
- Demonstração e site continuam claros. No agendamento, Claro/Escuro salvos
  continuam ignorados (segue o aparelho); só o azul salvo vale ali.
- Validação local (banco descartável limpo, dados fictícios): Vitest 70 verdes;
  `aparencia-e-notificacoes` (3 testes, com o novo do azul) e
  `portal-visao-geral` verdes.

**Não feito:** demais telas do portal com arranjo próprio (hoje só recebem as
cores), entrada do portal (`/portal`, login) e conta do dono.

**Próximo passo:** avaliação visual do dono. Depois, decidir se o tema entra
na conta do dono e quais telas do portal ganham arranjo próprio.

**Layout único em todos os temas (2026-11-18, branch `fix/layout-unico-todos-temas`):**

- Problema: com Claro, Escuro ou Seguir aparelho, o portal e `/conta` voltavam
  ao arranjo antigo (seis cartões soltos na Visão geral, menus sem grupos e
  sem os ícones de Relatórios e Segurança).
- Causa: três mecanismos prendiam a estrutura ao tema: o hook `useTemaAzul`
  (Visão geral do portal e grupos do menu de `/conta`), a variante Tailwind
  `azul:` (títulos e linhas do menu do portal, bordas dos menus) e as props de
  arranjo `azul` das peças da Visão geral.
- Correção: o arranjo do azul virou o único. `visao-geral-azul.tsx` virou
  `visao-geral-conteudo.tsx`; o arranjo antigo e `useTemaAzul` saíram; a
  variante `azul:` saiu do CSS. Menus agrupados para dono e gerente em
  qualquer tema (funcionário segue com a lista curta). Os dois ajustes que
  eram só de cor viraram tokens por tema: `--color-chrome-brand` (marca no
  menu do portal) e `--color-chrome-ink-active` (texto do item ativo). Nos
  temas Claro e Escuro esses tokens repetem a cor do texto do menu, então a
  paleta deles não mudou.
- Guardas: `src/lib/aparencia/layout-independente-do-tema.test.ts` reprova
  variante de classe por tema, leitura da preferência fora da aparência e
  grupo de menu condicionado; `tests/browser/layout-por-tema-flow.spec.ts`
  (`npm run test:browser:layout-temas`) troca o tema pelo seletor, navega e
  exige a mesma estrutura e as mesmas posições em todos os temas, no
  computador e no celular, com capturas de cada local.
- Contraste: Escuro e Azul e branco passam AA nos pares usados. No Claro, o
  laranja de destaque sobre branco fica em 4,3:1 e o aviso sobre o fundo de
  aviso em 3,3:1, os mesmos valores dos botões principais e selos que o Claro
  já tinha; a paleta não foi alterada.
