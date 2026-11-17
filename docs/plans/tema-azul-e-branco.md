# Tema opcional "Azul e branco"

**Estado:** registrado em 2026-11-17. Primeira versão LOCAL feita em
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

**Não feito:** demais telas do portal com arranjo próprio (hoje só recebem as
cores), entrada do portal (`/portal`, login) e conta do dono. Sem teste de
navegador versionado para o tema azul.

**Próximo passo:** avaliação visual do dono. Depois, decidir se o tema entra
na conta do dono e quais telas do portal ganham arranjo próprio.
