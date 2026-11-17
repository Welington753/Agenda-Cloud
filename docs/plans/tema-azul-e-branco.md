# Tema opcional "Azul e branco"

**Estado:** registrado em 2026-11-17. **Não iniciado.** Nada implementado,
testado ou publicado. Esta tarefa não altera a fila operacional já planejada
(publicação em etapas, `publicacao-consolidada-b5b2704.md`); entra depois,
quando o dono pedir.

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

## Na próxima sessão

1. Conferir como temas e componentes estão organizados hoje (ponto de partida:
   `data-tema` e tokens descritos em `agendamento-mobile-temas.md`).
2. Propor a implementação aproveitando a estrutura existente.
3. Apresentar uma tela representativa no computador e no celular antes de
   expandir para as demais.
