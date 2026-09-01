// Motor de comissão: funções puras, sem dependência de storage — mesmo padrão de
// src/lib/availability/engine.ts. `consulta`/orquestração fica no repositório
// (src/lib/repositories/index.ts), não aqui.

import type { LancamentoComissao, Profissional, Servico, TipoComissao } from "@/lib/types";

export interface RegraAplicada {
  tipo: TipoComissao;
  valor: number;
}

export interface ResultadoCalculoComissao {
  valorProfissionalCentavos: number;
  valorEstabelecimentoCentavos: number;
}

/** Calcula a divisão a partir do preço já congelado no agendamento — nunca relê o
 * preço atual do serviço. Arredondamento: `Math.round`, determinístico, ,5
 * arredonda para cima (comportamento padrão do JS para números positivos). O
 * valor do profissional nunca excede o preço do agendamento, mesmo que a regra
 * fixa tenha sido validada contra um preço de serviço diferente do congelado. */
export function calcularComissao(precoAgendamentoCentavos: number, regra: RegraAplicada): ResultadoCalculoComissao {
  const bruto = regra.tipo === "percentual" ? Math.round((precoAgendamentoCentavos * regra.valor) / 100) : regra.valor;
  const valorProfissionalCentavos = Math.max(0, Math.min(bruto, precoAgendamentoCentavos));
  const valorEstabelecimentoCentavos = precoAgendamentoCentavos - valorProfissionalCentavos;
  return { valorProfissionalCentavos, valorEstabelecimentoCentavos };
}

export interface EntradaValidacaoRegra {
  tipo: TipoComissao;
  valor: number;
  profissional: Pick<Profissional, "tenantId" | "servicosIds">;
  servico: Pick<Servico, "id" | "tenantId" | "precoCentavos">;
}

export interface ResultadoValidacaoRegra {
  valido: boolean;
  erro?: string;
}

/** Validação pura de uma regra antes de gravar — a UI chama isto antes de
 * `comissaoRegraRepository.salvar`. Não garante unicidade (isso é estrutural no
 * repositório, upsert por profissional+serviço). */
export function validarRegraComissao(entrada: EntradaValidacaoRegra): ResultadoValidacaoRegra {
  if (entrada.profissional.tenantId !== entrada.servico.tenantId) {
    return { valido: false, erro: "Profissional e serviço precisam pertencer ao mesmo estabelecimento." };
  }
  if (!entrada.profissional.servicosIds.includes(entrada.servico.id)) {
    return { valido: false, erro: "Este serviço não está vinculado a este profissional." };
  }
  if (entrada.tipo === "percentual") {
    if (entrada.valor < 0 || entrada.valor > 100) {
      return { valido: false, erro: "O percentual precisa estar entre 0% e 100%." };
    }
  } else {
    if (entrada.valor < 0) {
      return { valido: false, erro: "O valor fixo não pode ser negativo." };
    }
    if (entrada.servico.precoCentavos !== undefined && entrada.valor > entrada.servico.precoCentavos) {
      return { valido: false, erro: "O valor fixo não pode ser maior que o preço do serviço." };
    }
  }
  return { valido: true };
}

export interface TotaisComissao {
  totalServicosCentavos: number;
  totalProfissionalCentavos: number;
  totalEstabelecimentoCentavos: number;
}

/** Soma simples do que for passado — a página decide o que filtrar (período,
 * profissional, status) antes de chamar isto; a função não tem opinião sobre
 * incluir ou não lançamentos estornados. */
export function calcularTotaisRelatorio(lancamentos: LancamentoComissao[]): TotaisComissao {
  return lancamentos.reduce(
    (totais, l) => ({
      totalServicosCentavos: totais.totalServicosCentavos + l.precoAgendamentoCentavos,
      totalProfissionalCentavos: totais.totalProfissionalCentavos + l.valorProfissionalCentavos,
      totalEstabelecimentoCentavos: totais.totalEstabelecimentoCentavos + l.valorEstabelecimentoCentavos,
    }),
    { totalServicosCentavos: 0, totalProfissionalCentavos: 0, totalEstabelecimentoCentavos: 0 }
  );
}
