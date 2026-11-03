"use client";

// Planos e preços (portal da plataforma): preço mensal e trimestral de cada
// plano no catálogo. Sem preço gravado, o plano aparece como PENDENTE, nunca
// como gratuito. Cada mudança é uma linha nova, com quem, quando e por quê;
// períodos e pagamentos já registrados não são recalculados.
//
// Os valores propostos no plano comercial NÃO estão aprovados: nada é
// gravado aqui sem a decisão do proprietário da plataforma.
import { useState } from "react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { Retorno, useResultado } from "@/components/administracao/resultado-acao";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { acaoAdministrativa, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import { dataCadastro, ehCatalogoDePrecos, type Ciclo } from "@/lib/administracao/contratos";
import { centavosDe, CICLOS, reais, textoDoValor } from "@/lib/administracao/validade";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

interface Edicao {
  planId: string;
  planName: string;
  cycle: Ciclo;
  atual: number | null;
}

export default function PlanosEPrecosPage() {
  const { estado, recarregar } = useLeituraPlataforma("/platform/prices", ehCatalogoDePrecos);
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(recarregar);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [chave, setChave] = useState(novaChaveDeFormulario);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");

  if (estado.status !== "pronto") return <EstadoLeitura estado={estado} recarregar={recarregar} />;
  const catalogo = estado.dados;

  function abrir(e: Edicao) {
    setChave(novaChaveDeFormulario());
    setValor(e.atual ? textoDoValor(e.atual) : "");
    setMotivo("");
    setEdicao(e);
  }

  const centavos = centavosDe(valor);
  const podeConfirmar = !!edicao && centavos !== null && centavos !== edicao.atual;

  async function confirmar() {
    if (!edicao || !podeConfirmar) return;
    const alvo = edicao;
    const corpo = {
      requestKey: chave,
      expectedCurrentCents: alvo.atual,
      amountCents: centavos,
      ...(motivo.trim().length >= 3 ? { reason: motivo.trim() } : {}),
    };
    setEdicao(null);
    await executar(
      () =>
        executarSensivel(() =>
          acaoAdministrativa(`/platform/plans/${encodeURIComponent(alvo.planId)}/prices/${alvo.cycle}`, "PUT", corpo),
        ),
      `Preço ${alvo.cycle === "MONTHLY" ? "mensal" : "trimestral"} do plano ${alvo.planName} atualizado.`,
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Planos e preços</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Preço do catálogo por plano e ciclo. Vale para os próximos pagamentos que seguirem o catálogo; o valor
            contratado de cada cliente (na ficha) vem antes dele. Períodos e pagamentos já registrados não mudam. Preço
            não definido aparece como pendente, nunca como gratuito.
          </p>
        </div>
        <Botao variante="secundaria" onClick={recarregar} className="min-h-11">
          Atualizar
        </Botao>
      </header>
      <Retorno mensagem={mensagem} />
      <div className="grid gap-4 md:grid-cols-3" data-testid="catalogo-de-precos">
        {catalogo.items.map((plano) => (
          <Cartao key={plano.id}>
            <CartaoCorpo className="space-y-3">
              <div>
                <h2 className="font-semibold">{plano.name}</h2>
                <p className="text-xs text-ink-soft">Até {plano.maxProfessionals} profissionais</p>
              </div>
              <ul className="space-y-2">
                {plano.prices.map((p) => (
                  <li key={p.cycle} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{CICLOS[p.cycle]}</span>
                    {p.current ? (
                      <span className="font-semibold" data-testid={`preco-${plano.id}-${p.cycle}`}>
                        {reais(p.current.amountCents!)}
                      </span>
                    ) : (
                      <Badge cor="aviso" data-testid={`preco-${plano.id}-${p.cycle}`}>
                        Pendente
                      </Badge>
                    )}
                    {catalogo.canManage && (
                      <Botao
                        variante="secundaria"
                        className="min-h-11 w-full"
                        disabled={ocupado}
                        onClick={() =>
                          abrir({ planId: plano.id, planName: plano.name, cycle: p.cycle, atual: p.current?.amountCents ?? null })
                        }
                      >
                        {p.current ? "Alterar" : "Definir"} preço {p.cycle === "MONTHLY" ? "mensal" : "trimestral"}
                      </Botao>
                    )}
                  </li>
                ))}
              </ul>
            </CartaoCorpo>
          </Cartao>
        ))}
      </div>
      <Cartao>
        <CartaoCorpo className="space-y-2">
          <h2 className="font-semibold">Histórico de preços do catálogo</h2>
          {catalogo.history.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhum preço foi definido ainda.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {catalogo.history.map((m) => (
                <li key={m.id} className="break-words">
                  {dataCadastro(m.recordedAt)} · {m.planName} · {CICLOS[m.cycle]}: {reais(m.amountCents!)} ·{" "}
                  {m.recordedBy.name}
                  {m.reason ? ` · ${m.reason}` : ""}
                </li>
              ))}
            </ul>
          )}
        </CartaoCorpo>
      </Cartao>
      <Modal
        aberto={edicao !== null}
        aoFechar={() => setEdicao(null)}
        titulo={edicao ? `Preço ${edicao.cycle === "MONTHLY" ? "mensal" : "trimestral"} · ${edicao.planName}` : ""}
        rodape={
          <>
            <Botao variante="secundaria" className="min-h-11" onClick={() => setEdicao(null)}>
              Cancelar
            </Botao>
            <Botao className="min-h-11" disabled={!podeConfirmar || ocupado} onClick={() => void confirmar()}>
              Salvar preço
            </Botao>
          </>
        }
      >
        <div className="space-y-3" data-testid="form-preco-catalogo">
          <p>
            Atual: {edicao?.atual ? reais(edicao.atual) : "pendente"}. O novo preço vale para os próximos pagamentos que
            seguirem o catálogo; nada já registrado muda.
          </p>
          <label className="block text-sm font-medium">
            Novo preço (R$)
            <input className={CAMPO} inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            Motivo (opcional, fica no histórico)
            <input className={CAMPO} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          {valor && centavos === null && <p className="text-xs text-[color:var(--color-danger)]">Valor inválido.</p>}
        </div>
      </Modal>
    </div>
  );
}
