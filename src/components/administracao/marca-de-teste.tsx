"use client";

// Marca de estabelecimento de teste na ficha do portal. O botão só aparece
// quando o servidor disse que esta conta pode usá-lo (`allowedActions.markTest`),
// e o servidor confere de novo.
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import type { DetalheEstabelecimento } from "@/lib/administracao/contratos";
import { Retorno, useResultado } from "./resultado-acao";

/** Estabelecimento de teste: a página pública continua funcionando, mas sai
 * da busca (`noindex`). Sem senha (como os dados cadastrais); a versão lida
 * vai junto, e o servidor audita o valor anterior e o novo. */
export function MarcaDeTeste({ item, aoMudar }: { item: DetalheEstabelecimento; aoMudar: () => void }) {
  const { mensagem, ocupado, executar } = useResultado(aoMudar);
  if (item.isTest === undefined) return null;
  const marcado = item.isTest;

  function alternar() {
    void executar(
      () =>
        acaoAdministrativa(`/platform/establishments/${encodeURIComponent(item.id)}/test-flag`, "PUT", {
          expectedUpdatedAt: item.updatedAt,
          isTest: !marcado,
        }),
      marcado ? "Marca de teste retirada. A página volta a poder aparecer na busca." : "Marcado como teste. A página sai da busca.",
    );
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-3" data-testid="marca-de-teste">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Busca na internet</h2>
          <Badge cor={marcado ? "aviso" : "neutro"}>{marcado ? "Teste: fora da busca" : "Real: pode aparecer na busca"}</Badge>
        </div>
        <p className="text-sm text-ink-soft">
          Um estabelecimento de teste continua com a página de agendamento funcionando
          (<span className="break-all">/agendar/{item.slug}</span>), mas ela não aparece no Google e em outros buscadores.
          Nenhum estabelecimento é marcado sozinho: os testes antigos precisam ser marcados aqui.
        </p>
        {item.allowedActions.markTest && (
          <Botao variante="secundaria" className="min-h-11" disabled={ocupado} onClick={alternar}>
            {marcado ? "Retirar marca de teste" : "Marcar como teste"}
          </Botao>
        )}
        <Retorno mensagem={mensagem} />
      </CartaoCorpo>
    </Cartao>
  );
}
