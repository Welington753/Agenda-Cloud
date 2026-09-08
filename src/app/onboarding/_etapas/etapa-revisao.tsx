import { ShieldCheck } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { CATEGORIAS_NEGOCIO } from "@/lib/verticals/terminologia";
import { obterDefinicaoPlano } from "@/lib/planos";
import {
  OPCOES_ESTRUTURA,
  OPCOES_OBJETIVO,
  OPCOES_QUANTIDADE_PROFISSIONAIS,
  planoSugerido,
  type RespostasOnboarding,
} from "@/lib/onboarding/onboarding";

function rotuloDe<T extends string>(opcoes: { valor: T; rotulo: string }[], valor: T | null): string {
  return opcoes.find((o) => o.valor === valor)?.rotulo ?? "—";
}

export function EtapaRevisao({ respostas }: { respostas: RespostasOnboarding }) {
  const plano = obterDefinicaoPlano(planoSugerido(respostas));

  const linhas = [
    { rotulo: "Negócio", valor: respostas.nomeNegocio || "—" },
    { rotulo: "Segmento", valor: rotuloDe(CATEGORIAS_NEGOCIO, respostas.segmento) },
    { rotulo: "Estrutura", valor: rotuloDe(OPCOES_ESTRUTURA, respostas.estrutura) },
    { rotulo: "Profissionais", valor: rotuloDe(OPCOES_QUANTIDADE_PROFISSIONAIS, respostas.quantidadeProfissionais) },
    { rotulo: "Objetivo principal", valor: rotuloDe(OPCOES_OBJETIVO, respostas.objetivo) },
    { rotulo: "Plano sugerido", valor: plano.nome },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-ink">Revise antes de criar sua demonstração</h2>
        <p className="text-sm text-ink-soft">Você pode voltar e mudar qualquer resposta antes de continuar.</p>
      </div>

      <Cartao>
        <CartaoCorpo>
          <dl className="divide-y divide-border">
            {linhas.map((linha) => (
              <div key={linha.rotulo} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <dt className="text-ink-soft">{linha.rotulo}</dt>
                <dd className="font-semibold text-ink">{linha.valor}</dd>
              </div>
            ))}
          </dl>
        </CartaoCorpo>
      </Cartao>

      <Cartao className="border-dashed">
        <CartaoCorpo className="flex items-start gap-3">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-[color:var(--color-info)]" />
          <p className="text-sm text-ink-soft">
            Ao continuar, criamos um estabelecimento de demonstração salvo só neste navegador, e você entra direto no
            painel — sem senha, sem conta real e sem cobrança.
          </p>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}
