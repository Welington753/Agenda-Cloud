"use client";

import { useParams } from "next/navigation";
import {
  ehDetalheEstabelecimento,
  SITUACOES,
  SEGMENTOS,
  dataCadastro,
  precoCatalogo,
} from "@/lib/administracao/contratos";
import { ROTA_ESTABELECIMENTOS_ADMINISTRADOS } from "@/lib/administracao/rotas";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Botao, LinkBotao } from "@/components/ui/button";
import { PessoasEstabelecimento } from "@/components/administracao/pessoas-estabelecimento";

function Dado({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-soft">{titulo}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{valor}</dd>
    </div>
  );
}
export default function DetalhePage() {
  const { id } = useParams<{ id: string }>();
  const { estado, recarregar } = useLeituraPlataforma(
    `/platform/establishments/${encodeURIComponent(id)}`,
    ehDetalheEstabelecimento,
  );
  if (estado.status !== "pronto")
    return <EstadoLeitura estado={estado} recarregar={recarregar} />;
  const item = estado.dados;
  return (
    <div className="space-y-6">
      <LinkBotao
        href={ROTA_ESTABELECIMENTOS_ADMINISTRADOS}
        variante="fantasma"
        className="min-h-11"
      >
        ← Estabelecimentos
      </LinkBotao>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold">{item.name}</h1>
          <p className="mt-1 break-all text-sm text-ink-soft">{item.slug}</p>
        </div>
        <Botao variante="secundaria" onClick={recarregar} className="min-h-11">
          Atualizar
        </Botao>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao>
          <CartaoCorpo>
            <h2 className="mb-4 font-semibold">Estabelecimento</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Dado
                titulo="Situação do acesso"
                valor={SITUACOES[item.status]}
              />
              <Dado
                titulo="Segmento"
                valor={SEGMENTOS[item.category] ?? item.category}
              />
              <Dado
                titulo="Cadastrado em"
                valor={dataCadastro(item.createdAt)}
              />
              <Dado titulo="Fuso horário" valor={item.timezone} />
            </dl>
            {item.status === "TRIAL" && (
              <p className="mt-4 text-sm text-ink-soft">
                Teste previsto até {dataCadastro(item.trial.trialEndAt)}, pela
                política atual de {item.trial.durationDays} dias a partir do
                cadastro.
              </p>
            )}
          </CartaoCorpo>
        </Cartao>
        <Cartao>
          <CartaoCorpo>
            <h2 className="mb-4 font-semibold">Plano</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Dado titulo="Plano associado" valor={item.plan.name} />
              <Dado
                titulo="Preço do catálogo"
                valor={precoCatalogo(item.plan.catalogPriceCents)}
              />
              <Dado
                titulo="Limite de profissionais"
                valor={String(item.plan.maxProfessionals)}
              />
              <Dado
                titulo="Limite de unidades"
                valor={String(item.plan.maxUnits)}
              />
            </dl>
            <p className="mt-4 text-xs text-ink-soft">
              O preço do catálogo não comprova o valor contratado nem um
              pagamento.
            </p>
          </CartaoCorpo>
        </Cartao>
        <Cartao>
          <CartaoCorpo>
            <h2 className="mb-4 font-semibold">Responsáveis</h2>
            {item.owners.length === 0 ? (
              <p className="text-sm text-ink-soft">
                Sem responsável vinculado.
              </p>
            ) : (
              <ul className="space-y-4">
                {item.owners.map((owner) => (
                  <li key={owner.id} className="space-y-1 text-sm">
                    <p className="break-words font-semibold">{owner.name}</p>
                    <p className="break-all">{owner.email}</p>
                    <p>{owner.phone || "Telefone não informado"}</p>
                    <p className="text-xs text-ink-soft">
                      Conta{" "}
                      {owner.status === "ACTIVE"
                        ? "ativa"
                        : owner.status === "INVITED"
                          ? "convidada"
                          : "suspensa"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CartaoCorpo>
        </Cartao>
        <Cartao>
          <CartaoCorpo>
            <h2 className="mb-4 font-semibold">Uso atual</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Dado
                titulo="Profissionais ativos"
                valor={String(item.usage.professionals)}
              />
              <Dado
                titulo="Serviços ativos"
                valor={String(item.usage.services)}
              />
              <Dado
                titulo="Clientes cadastrados"
                valor={String(item.usage.consumers)}
              />
              <Dado titulo="Unidades" valor={String(item.units.length)} />
            </dl>
          </CartaoCorpo>
        </Cartao>
      </div>
      <Cartao>
        <CartaoCorpo>
          <h2 className="mb-3 font-semibold">Unidades</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {item.units.map((unit) => (
              <li key={unit.id}>
                <p className="break-words text-sm font-semibold">
                  {unit.name}
                  {unit.isPrimary ? " · Principal" : ""}
                </p>
                <p className="mt-1 break-words text-sm text-ink-soft">
                  {unit.address || "Endereço não informado"}
                </p>
              </li>
            ))}
          </ul>
          {!item.units.length && (
            <p className="text-sm text-ink-soft">Nenhuma unidade cadastrada.</p>
          )}
        </CartaoCorpo>
      </Cartao>
      <PessoasEstabelecimento tenantId={item.id} />
      <Cartao>
        <CartaoCorpo>
          <h2 className="font-semibold">Mensalidades e pagamentos</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Ainda não há registro financeiro nesta área. Valor contratado,
            vencimento e pagamentos recebidos não estão disponíveis. A situação
            do acesso acima não indica se houve pagamento.
          </p>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}
