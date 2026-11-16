# Preços dos planos na página inicial

Lote pequeno, só no web. A seção "Planos" da página inicial passa a mostrar os preços aprovados. Substitui o "sem preço" de `pagina-inicial-repaginada.md` (estrutura, item 6); o resto daquele plano continua valendo.

## Valores aprovados

| Plano | Mensal | Trimestral (total dos três meses) | Profissionais |
|---|---|---|---|
| Básico | R$ 39,90 | R$ 107,90 | até 2 |
| Pro | R$ 69,90 | R$ 188,90 | até 5 |
| Max | R$ 119,90 | R$ 323,90 | até 20 |

## Decisões

- **Fonte dos valores:** não existe fonte pública de preços. O catálogo fica no banco e só o portal da administração o lê (`backend/src/platform`, `MASTER_OWNER`). A página inicial é estática e não chama o backend (`src/lib/site/sem-chamadas-backend.test.ts`). Por isso os valores ficam centralizados em `src/lib/site/conteudo-comercial.ts` (`PLANOS_COMERCIAIS`), em centavos inteiros.
- **Consequência:** mudar um preço no catálogo do portal não muda a página. Toda alteração futura de preço precisa ser repetida em `conteudo-comercial.ts`, no mesmo lote, e o teste ao lado trava os valores.
- **Apresentação:** mesma disposição dos três planos. Preço mensal em destaque, opção trimestral abaixo e a frase "Total dos três meses, não um valor por mês." em cada plano.
- **Sem percentual de desconto**, sem checkout, sem pagamento automático e sem teste grátis. "Como obter acesso" continua levando a `#contato`.
- **Não muda:** catálogo, contratos, pagamentos, backend, JSON-LD (continua sem preço) e os recursos e limites de cada plano.

## Estado e retomada

- **Feito:**
  - branch `feat/home-precos-planos` a partir de `187c507`;
  - preços em `conteudo-comercial.ts`, seção em `src/components/site/planos.tsx` e testes em `conteudo-comercial.test.ts`;
  - capturas em 1280px e 390px conferidas, sem rolagem horizontal;
  - build com `/` estática.
- **Validação local:** Vitest de `src/lib/site` e das guardas da demonstração (84 testes), lint dos arquivos alterados e `tsc --noEmit`, todos verdes.
- **Próximo passo:** revisão do PR. Sem merge nem deploy até aprovação.
- **Antes de publicar:** conferir se os preços do catálogo no portal ("Planos e preços") são os mesmos desta página. Este lote não altera o catálogo.
- **Só neste computador:** a worktree `C:\wt\precos`.
- **Separado deste lote:** a recuperação do login do piloto e o PR #112.
