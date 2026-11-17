"use client";

// Catálogo da assinatura modular no portal: preço mensal do Agendamento
// essencial e de cada adicional, com a disponibilidade (só leitura: muda
// quando o recurso é liberado no código). Cada mudança é uma linha nova;
// assinaturas já contratadas não são reajustadas. Valores de exemplo nunca
// são gravados por padrão: sem preço, aparece "a definir".
import { useState } from "react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { EstadoLeitura } from "./estado-leitura";
import { useAcaoSensivel } from "./reautenticacao";
import { Retorno, useResultado } from "./resultado-acao";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { acaoAdministrativa, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import { ehCatalogoAssinatura, ROTULO_DISPONIBILIDADE } from "@/lib/administracao/assinatura";
import { dataCadastro } from "@/lib/administracao/contratos";
import { centavosDe, reais, textoDoValor } from "@/lib/administracao/validade";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

interface Edicao {
  rotulo: string;
  caminho: string;
  atual: number | null;
}

export function CatalogoModular() {
  const { estado, recarregar } = useLeituraPlataforma("/platform/addons", ehCatalogoAssinatura);
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(recarregar);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [chave, setChave] = useState(novaChaveDeFormulario);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");

  if (estado.status !== "pronto") return <EstadoLeitura estado={estado} recarregar={recarregar} />;
  const catalogo = estado.dados;
  const centavos = centavosDe(valor);
  const podeConfirmar = !!edicao && centavos !== null && centavos !== edicao.atual;

  function abrir(e: Edicao) {
    setChave(novaChaveDeFormulario());
    setValor(e.atual ? textoDoValor(e.atual) : "");
    setMotivo("");
    setEdicao(e);
  }

  async function confirmar() {
    if (!edicao || !podeConfirmar) return;
    const alvo = edicao;
    setEdicao(null);
    await executar(
      () =>
        executarSensivel(() =>
          acaoAdministrativa(alvo.caminho, "PUT", {
            requestKey: chave,
            expectedCurrentCents: alvo.atual,
            amountCents: centavos,
            ...(motivo.trim().length >= 3 ? { reason: motivo.trim() } : {}),
          }),
        ),
      `Preço de ${alvo.rotulo} atualizado. Assinaturas já contratadas não mudam.`,
    );
  }

  const linhas = [
    {
      chave: "base",
      nome: "Agendamento essencial",
      descricao: "Agenda, link de agendamento, profissionais, serviços, clientes, equipe e recebimentos.",
      disponibilidade: null as string | null,
      preco: catalogo.basePriceCents,
      editavel: true,
      caminho: `/platform/plans/${encodeURIComponent(catalogo.basePlanId)}/prices/MONTHLY`,
    },
    ...catalogo.addons.map((a) => ({
      chave: a.code,
      nome: a.name,
      descricao: a.description,
      disponibilidade: ROTULO_DISPONIBILIDADE[a.availability],
      preco: a.priceCents,
      editavel: true,
      caminho: `/platform/addons/${encodeURIComponent(a.code)}/price`,
    })),
  ];

  return (
    <section className="space-y-4" aria-labelledby="titulo-modular">
      <div>
        <h2 id="titulo-modular" className="text-xl font-bold">
          Assinatura modular
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Preço mensal do essencial e de cada adicional. Só adicionais disponíveis podem ser contratados; os em
          desenvolvimento e planejados aparecem desativados e não entram no total. Mudar um preço não reajusta
          assinaturas existentes.
        </p>
      </div>
      <Retorno mensagem={mensagem} />
      <ul className="grid gap-3 md:grid-cols-2" data-testid="catalogo-modular">
        {linhas.map((l) => (
          <li key={l.chave}>
            <Cartao>
              <CartaoCorpo className="space-y-2">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {l.nome}
                  {l.disponibilidade && <Badge cor={l.disponibilidade === "Disponível" ? "sucesso" : "neutro"}>{l.disponibilidade}</Badge>}
                </p>
                <p className="text-xs text-ink-soft">{l.descricao}</p>
                <p className="text-sm" data-testid={`preco-modular-${l.chave}`}>
                  {l.preco === null ? <Badge cor="aviso">A definir</Badge> : <strong>{reais(l.preco)} / mês</strong>}
                </p>
                {catalogo.canManage && l.editavel && (
                  <Botao
                    variante="secundaria"
                    className="min-h-11 w-full"
                    disabled={ocupado}
                    onClick={() => abrir({ rotulo: l.nome, caminho: l.caminho, atual: l.preco })}
                  >
                    {l.preco === null ? "Definir" : "Alterar"} preço mensal
                  </Botao>
                )}
              </CartaoCorpo>
            </Cartao>
          </li>
        ))}
      </ul>
      {catalogo.history.length > 0 && (
        <Cartao>
          <CartaoCorpo className="space-y-2">
            <h3 className="font-semibold">Histórico de preços dos adicionais</h3>
            <ul className="space-y-1 text-sm">
              {catalogo.history.map((m) => (
                <li key={m.id} className="break-words">
                  {dataCadastro(m.recordedAt)} · {m.moduleName}: {reais(m.amountCents)} · {m.recordedBy}
                  {m.reason ? ` · ${m.reason}` : ""}
                </li>
              ))}
            </ul>
          </CartaoCorpo>
        </Cartao>
      )}
      <Modal
        aberto={!!edicao}
        aoFechar={() => setEdicao(null)}
        titulo={`Preço mensal de ${edicao?.rotulo ?? ""}`}
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
        <div className="space-y-3">
          <p className="text-sm">
            Preço atual: {edicao?.atual === null || edicao?.atual === undefined ? "a definir" : reais(edicao.atual)}. O novo
            preço vale para as próximas contratações; assinaturas existentes não mudam.
          </p>
          <label className="block text-sm font-medium">
            Novo preço mensal (R$)
            <input className={CAMPO} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            Motivo (opcional)
            <input className={CAMPO} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
        </div>
      </Modal>
    </section>
  );
}
