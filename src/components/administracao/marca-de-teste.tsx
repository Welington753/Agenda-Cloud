"use client";

// Marca "Interno/teste" na ficha do portal (`tenants.is_test`). O botão só
// aparece quando o servidor disse que esta conta pode usá-lo
// (`allowedActions.markTest`), e o servidor confere de novo e audita.
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { acaoAdministrativa } from "@/lib/administracao/api-contas";
import type { DetalheEstabelecimento } from "@/lib/administracao/contratos";
import { Retorno, useResultado } from "./resultado-acao";

/** Interno/teste: sai dos números e da lista padrão de clientes, e a página
 * pública sai da busca (`noindex`), mas continua acessível pelo link. Sem
 * senha (como os dados cadastrais); a versão lida vai junto, e o servidor
 * audita o valor anterior e o novo. Depois de mudar, a ficha é relida. */
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
      marcado
        ? "Marca retirada. O estabelecimento volta a contar como cliente, e a página pode aparecer na busca."
        : "Marcado como interno/teste. Saiu dos números de clientes, e a página sai da busca.",
    );
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-3" data-testid="marca-de-teste">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Classificação: cliente ou interno/teste</h2>
          <Badge cor={marcado ? "aviso" : "neutro"}>{marcado ? "Interno/teste" : "Cliente (padrão)"}</Badge>
        </div>
        <p className="text-sm text-ink-soft">
          Um estabelecimento interno/teste fica fora da lista padrão e dos números de clientes da Visão geral (aparece em
          &quot;Internos/teste&quot; e &quot;Todos&quot;). A página de agendamento continua funcionando e acessível pelo
          link (<span className="break-all">/agendar/{item.slug}</span>), mas não aparece no Google e em outros buscadores.
          Cobrança, plano e limites não mudam.
        </p>
        <p className="text-xs text-ink-soft">
          Nenhum estabelecimento é marcado sozinho. &quot;Cliente&quot; é o padrão de todo cadastro: um cadastro antigo
          aparece como cliente até ser marcado aqui, e isso não comprova que ele foi conferido.
        </p>
        {item.allowedActions.markTest && (
          <Botao variante="secundaria" className="min-h-11" disabled={ocupado} onClick={alternar}>
            {marcado ? "Desmarcar: é cliente" : "Marcar como interno/teste"}
          </Botao>
        )}
        <Retorno mensagem={mensagem} />
      </CartaoCorpo>
    </Cartao>
  );
}
