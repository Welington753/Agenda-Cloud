"use client";

// Formulário de cadastro de cliente. Os campos são exatamente os do DTO do
// backend (consumer.dto.ts): nome, WhatsApp e e-mail opcional. Cadastrar um
// cliente não cria login nem dá acesso ao sistema.
//
// Envio duplicado é barrado aqui (`enviando` desabilita o botão e o submit
// sai cedo) e de novo no hook (ref síncrona em use-clientes-reais.ts).
import { useState, type FormEvent, type ReactNode } from "react";
import { Botao } from "@/components/ui/button";
import {
  paraDadosCliente,
  validarCliente,
  type ErrosCliente,
  type FormularioCliente as Campos,
} from "@/lib/clientes/cadastro";
import type { DadosCadastroCliente } from "@/lib/api/consumers-api";

interface FormularioClienteProps {
  enviando: boolean;
  /** Falha do último envio, já em português. */
  erro: string | null;
  /** Ação extra junto do erro (ex.: pesquisar o WhatsApp após duplicidade). */
  acaoDoErro?: ReactNode;
  aoEnviar: (dados: DadosCadastroCliente, campos: Campos) => void;
  aoCancelar: () => void;
}

const CLASSE_CAMPO =
  "w-full rounded-[var(--radius-control)] border bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent";

export function FormularioCliente({
  enviando,
  erro,
  acaoDoErro,
  aoEnviar,
  aoCancelar,
}: FormularioClienteProps) {
  const [campos, setCampos] = useState<Campos>({ nome: "", whatsapp: "", email: "" });
  const [errosCampo, setErrosCampo] = useState<ErrosCliente>({});

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const erros = validarCliente(campos);
    setErrosCampo(erros);
    if (Object.keys(erros).length > 0) return;
    aoEnviar(paraDadosCliente(campos), campos);
  }

  function campo(
    id: keyof Campos,
    rotulo: string,
    props: { type?: string; inputMode?: "tel" | "email"; placeholder?: string; autoComplete?: string },
    dica?: string,
  ) {
    const idCampo = `cliente-${id}`;
    const erroCampo = errosCampo[id];
    return (
      <div>
        <label htmlFor={idCampo} className="mb-1 block text-sm font-medium text-ink">
          {rotulo}
        </label>
        <input
          id={idCampo}
          type={props.type ?? "text"}
          inputMode={props.inputMode}
          autoComplete={props.autoComplete}
          placeholder={props.placeholder}
          value={campos[id]}
          disabled={enviando}
          onChange={(e) => setCampos((atual) => ({ ...atual, [id]: e.target.value }))}
          aria-invalid={erroCampo ? true : undefined}
          aria-describedby={erroCampo ? `${idCampo}-erro` : undefined}
          className={`${CLASSE_CAMPO} ${erroCampo ? "border-[color:var(--color-danger)]" : "border-border"}`}
        />
        {dica && !erroCampo && <p className="mt-1 text-xs text-ink-soft">{dica}</p>}
        {erroCampo && (
          <p id={`${idCampo}-erro`} className="mt-1 text-xs text-[color:var(--color-danger)]">
            {erroCampo}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      {campo("nome", "Nome do cliente", { autoComplete: "off" })}
      <div className="grid gap-4 sm:grid-cols-2">
        {campo(
          "whatsapp",
          "WhatsApp",
          { type: "tel", inputMode: "tel", placeholder: "(11) 90000-0000", autoComplete: "off" },
          "Com DDD. Cada WhatsApp só pode ser usado por um cliente neste estabelecimento.",
        )}
        {campo(
          "email",
          "E-mail (opcional)",
          { type: "email", inputMode: "email", autoComplete: "off" },
        )}
      </div>

      <p className="text-xs text-ink-soft">
        Cadastrar um cliente não cria login nem dá acesso ao sistema.
      </p>

      {erro && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-[color:var(--color-danger)]">
            {erro}
          </p>
          {acaoDoErro}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Botao type="submit" disabled={enviando} aria-busy={enviando}>
          {enviando ? "Cadastrando..." : "Cadastrar cliente"}
        </Botao>
        <Botao type="button" variante="secundaria" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
