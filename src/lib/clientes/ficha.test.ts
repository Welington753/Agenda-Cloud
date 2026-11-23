import { describe, expect, it } from "vitest";
import type { GrupoDeClientes, MembroDoGrupo } from "@/lib/api/consumers-api";
import {
  avisoDeMesmoNome,
  dataEHora,
  linhasDaTransferencia,
  linhasDoResumo,
  mensagemFalhaEdicao,
  mensagemFalhaUnificacao,
  podeEditarClientes,
  podeUnificarClientes,
  secoesDoGrupo,
} from "./ficha";

const membro = (id: string, relacoes: MembroDoGrupo["relacoes"], mesmoNome = 0): MembroDoGrupo => ({
  id,
  name: id,
  whatsapp: "(11) 98888-0000",
  email: null,
  relacoes,
  mesmoNome,
});

describe("secoesDoGrupo", () => {
  it("cadastro sozinho não tem seções", () => {
    expect(secoesDoGrupo({ chave: "k", membros: [membro("a", [])] })).toEqual([]);
  });

  it("separa \"Mesmo WhatsApp\" de \"Número parecido\"", () => {
    const grupo: GrupoDeClientes = {
      chave: "k",
      membros: [membro("a", ["MESMO_TELEFONE", "NUMERO_PARECIDO"]), membro("b", ["MESMO_TELEFONE", "NUMERO_PARECIDO"]), membro("c", ["NUMERO_PARECIDO"])],
    };
    expect(secoesDoGrupo(grupo).map((s) => [s.titulo, s.membros.map((m) => m.id)])).toEqual([
      ["Mesmo WhatsApp", ["a", "b"]],
      ["Número parecido (9º dígito ou DDD) — confira", ["c"]],
    ]);
  });
});

describe("textos", () => {
  it("mesmo nome só como sugestão", () => {
    expect(avisoDeMesmoNome(0)).toBeNull();
    expect(avisoDeMesmoNome(1)).toBe("Mesmo nome em outro cadastro — confira");
    expect(avisoDeMesmoNome(3)).toBe("Mesmo nome em outros 3 cadastros — confira");
  });

  it("resumo da ficha no singular e no plural", () => {
    expect(linhasDoResumo({ total: 1, concluidos: 0, cancelados: 2, faltas: 1, ultimoConcluido: null, proximo: null })).toEqual([
      "1 agendamento",
      "0 concluídos",
      "2 cancelados",
      "1 falta",
    ]);
  });

  it("data e hora do estabelecimento, sem converter fuso", () => {
    expect(dataEHora("2026-11-23", "09:05")).toBe("23/11/2026 às 09:05");
  });

  it("transferência sem somar valores", () => {
    expect(
      linhasDaTransferencia({ agendamentos: 3, concluidos: 1, cancelados: 1, faltas: 0, outros: 1, recebimentos: 1, comissoes: 2, pedidosPublicos: 0 }),
    ).toEqual([
      "3 agendamentos (1 concluído, 1 cancelado, 0 faltas, 1 a realizar ou aguardando)",
      "1 recebimento, que segue o agendamento",
      "2 comissões, que seguem os agendamentos",
    ]);
  });

  it("recusas pelo tipo, nunca pelo texto do servidor", () => {
    expect(mensagemFalhaEdicao({ tipo: "cliente_alterado", mensagem: "x" })).toContain("alterado por outra pessoa");
    expect(mensagemFalhaEdicao({ tipo: "duplicado", mensagem: "x" })).toContain("outra pessoa no mesmo número");
    expect(mensagemFalhaUnificacao({ tipo: "previa_desatualizada", mensagem: "x", previa: null })).toContain("mudaram desde a prévia");
    expect(mensagemFalhaUnificacao({ tipo: "sem_permissao" })).toBe("Só o dono do estabelecimento unifica cadastros.");
  });
});

describe("quem pode", () => {
  it("editar: quem tem CLIENTES_GERENCIAR; unificar: só o dono com a área", () => {
    const dono = { role: "DONO" as const, areas: ["CLIENTES_VER", "CLIENTES_GERENCIAR"] };
    const donoRestrito = { role: "DONO" as const, areas: ["CLIENTES_VER"] };
    const gerente = { role: "GERENTE" as const, areas: ["CLIENTES_VER", "CLIENTES_GERENCIAR"] };
    expect([podeEditarClientes(dono), podeUnificarClientes(dono)]).toEqual([true, true]);
    expect([podeEditarClientes(gerente), podeUnificarClientes(gerente)]).toEqual([true, false]);
    expect([podeEditarClientes(donoRestrito), podeUnificarClientes(donoRestrito)]).toEqual([false, false]);
    expect(podeUnificarClientes(null)).toBe(false);
  });
});
