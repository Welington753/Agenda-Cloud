"use client";

// Formulário de criação e edição de profissional real (Lote 6D.2). Nome é o
// único campo de identidade (iniciais/cor do avatar são calculadas pelo
// servidor, ver backend/src/professionals/avatar.ts — nunca pedidas aqui).
// Serviços realizados usam o mesmo submit: no cadastro viram `serviceIds` do
// POST; na edição a página separa em PATCH (nome) + PUT (vínculos), porque
// são dois endpoints reais, mas a pessoa só vê um botão "Salvar".
import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import type { ServicoReal } from "@/lib/api/services-api";
import { Botao } from "@/components/ui/button";
import { SeletorServicos } from "./seletor-servicos";

export interface DadosFormularioProfissional {
  name: string;
  serviceIds: string[];
}

interface FormularioProfissionalProps {
  /** Ausente = criação. */
  profissional?: ProfissionalReal;
  servicos: ServicoReal[];
  enviando: boolean;
  erro: string | null;
  aoEnviar: (dados: DadosFormularioProfissional) => void;
  aoCancelar: () => void;
}

export function FormularioProfissional({
  profissional,
  servicos,
  enviando,
  erro,
  aoEnviar,
  aoCancelar,
}: FormularioProfissionalProps) {
  const [nome, setNome] = useState(profissional?.name ?? "");
  const vinculadosOriginalmente = new Set(profissional?.services.map((s) => s.serviceId) ?? []);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set(vinculadosOriginalmente));
  const [erroNome, setErroNome] = useState<string | null>(null);

  const servicosAtivos = servicos.filter((s) => s.active);
  const nenhumServicoCadastrado = servicos.length === 0;
  const nenhumServicoElegivel =
    !nenhumServicoCadastrado && servicosAtivos.length === 0 && vinculadosOriginalmente.size === 0;

  function alternarServico(serviceId: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(serviceId)) novo.delete(serviceId);
      else novo.add(serviceId);
      return novo;
    });
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;

    const nomeLimpo = nome.trim();
    if (nomeLimpo === "") {
      setErroNome("Informe o nome do profissional.");
      return;
    }
    setErroNome(null);
    aoEnviar({ name: nomeLimpo, serviceIds: [...selecionados] });
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <div>
        <label htmlFor="nome-profissional" className="mb-1 block text-sm font-medium text-ink">
          Nome do profissional
        </label>
        <input
          id="nome-profissional"
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          aria-invalid={erroNome ? true : undefined}
          aria-describedby={erroNome ? "nome-profissional-erro" : undefined}
          className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent"
          placeholder="Ana Souza"
        />
        {erroNome && (
          <p id="nome-profissional-erro" className="mt-1 text-xs text-[color:var(--color-danger)]">
            {erroNome}
          </p>
        )}
      </div>

      {nenhumServicoCadastrado && (
        <p className="rounded-[var(--radius-control)] border border-dashed border-border p-3 text-sm text-ink-soft">
          Este estabelecimento ainda não tem serviços cadastrados. Você pode cadastrar o profissional
          sem vincular serviços agora, ou{" "}
          <Link href="/conta/servicos" className="font-medium text-accent hover:underline">
            cadastrar serviços primeiro
          </Link>
          .
        </p>
      )}

      {nenhumServicoElegivel && (
        <p className="rounded-[var(--radius-control)] border border-dashed border-border p-3 text-sm text-ink-soft">
          Não há serviço ativo disponível para vincular agora. Você pode cadastrar o profissional sem
          serviço, ou{" "}
          <Link href="/conta/servicos" className="font-medium text-accent hover:underline">
            reativar ou cadastrar um serviço
          </Link>
          .
        </p>
      )}

      <SeletorServicos
        servicos={servicos}
        vinculadosOriginalmente={vinculadosOriginalmente}
        selecionados={selecionados}
        aoAlternar={alternarServico}
        desabilitado={enviando}
      />

      {erro && (
        <p role="alert" className="text-sm text-[color:var(--color-danger)]">
          {erro}
        </p>
      )}

      <div className="flex gap-2">
        <Botao type="submit" disabled={enviando} aria-busy={enviando}>
          {enviando ? "Salvando..." : profissional ? "Salvar alterações" : "Cadastrar profissional"}
        </Botao>
        <Botao type="button" variante="secundaria" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
