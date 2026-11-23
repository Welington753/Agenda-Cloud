"use client";

// Edição do cadastro na ficha: nome, WhatsApp e e-mail, com a versão lida
// (`expectedUpdatedAt`). O id, o histórico e os nomes gravados em cada
// agendamento não mudam. Trocar o WhatsApp não leva a autorização de mensagem
// para o número novo (as preferências ficam com cada telefone).
//
// - WhatsApp de outro cliente (409): a tela pergunta se é outra pessoa no
//   mesmo número e só então reenvia com `outraPessoa`.
// - Alterado por outra pessoa (409): nada é salvo; a pessoa recarrega a ficha.
// - Sem resposta: resultado incerto; a pessoa recarrega antes de repetir.
import { useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { editarCliente, type ClienteReal, type FalhaClientesReal } from "@/lib/api/consumers-api";
import { validarCliente, type ErrosCliente, type FormularioCliente } from "@/lib/clientes/cadastro";
import { mensagemFalhaEdicao } from "@/lib/clientes/ficha";

interface EdicaoClienteProps {
  tenantId: string;
  cliente: ClienteReal & { updatedAt: string };
  aoSalvar: () => void;
  aoCancelar: () => void;
  aoRecarregar: () => void;
}

const CLASSE_CAMPO =
  "w-full rounded-[var(--radius-control)] border bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent";

export function EdicaoCliente({ tenantId, cliente, aoSalvar, aoCancelar, aoRecarregar }: EdicaoClienteProps) {
  const [campos, setCampos] = useState<FormularioCliente>({
    nome: cliente.name,
    whatsapp: cliente.whatsapp,
    email: cliente.email ?? "",
  });
  const [erros, setErros] = useState<ErrosCliente>({});
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<FalhaClientesReal | null>(null);

  async function salvar(outraPessoa: boolean) {
    if (enviando) return;
    const validacao = validarCliente(campos);
    setErros(validacao);
    if (Object.keys(validacao).length > 0) return;
    setEnviando(true);
    setFalha(null);
    const resultado = await editarCliente(tenantId, cliente.id, {
      name: campos.nome.trim(),
      whatsapp: campos.whatsapp.trim(),
      email: campos.email.trim(),
      expectedUpdatedAt: cliente.updatedAt,
      ...(outraPessoa ? { outraPessoa: true as const } : {}),
    });
    setEnviando(false);
    if (resultado.ok) aoSalvar();
    else setFalha(resultado.falha);
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    void salvar(false);
  }

  function campo(id: keyof FormularioCliente, rotulo: string, tipo: "text" | "tel" | "email") {
    const idCampo = `editar-cliente-${id}`;
    return (
      <div>
        <label htmlFor={idCampo} className="mb-1 block text-sm font-medium text-ink">
          {rotulo}
        </label>
        <input
          id={idCampo}
          type={tipo}
          inputMode={tipo === "tel" ? "tel" : tipo === "email" ? "email" : undefined}
          autoComplete="off"
          value={campos[id]}
          disabled={enviando}
          onChange={(e) => setCampos((atual) => ({ ...atual, [id]: e.target.value }))}
          aria-invalid={erros[id] ? true : undefined}
          aria-describedby={erros[id] ? `${idCampo}-erro` : undefined}
          className={`${CLASSE_CAMPO} ${erros[id] ? "border-[color:var(--color-danger)]" : "border-border"}`}
        />
        {erros[id] && (
          <p id={`${idCampo}-erro`} className="mt-1 text-xs text-[color:var(--color-danger)]">
            {erros[id]}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate data-testid="editar-cliente">
      {campo("nome", "Nome do cliente", "text")}
      <div className="grid gap-4 sm:grid-cols-2">
        {campo("whatsapp", "WhatsApp", "tel")}
        {campo("email", "E-mail (opcional)", "email")}
      </div>
      <p className="text-xs text-ink-soft">
        O histórico continua neste cadastro. Ao trocar o WhatsApp, a autorização de mensagens não passa para o número novo.
      </p>

      {falha && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-[color:var(--color-danger)]">
            {mensagemFalhaEdicao(falha)}
          </p>
          {falha.tipo === "duplicado" && (
            <Botao type="button" variante="secundaria" tamanho="sm" disabled={enviando} onClick={() => void salvar(true)} data-testid="editar-outra-pessoa">
              É outra pessoa no mesmo número: salvar assim mesmo
            </Botao>
          )}
          {(falha.tipo === "cliente_alterado" || falha.tipo === "falha_comunicacao") && (
            <Botao type="button" variante="secundaria" tamanho="sm" onClick={aoRecarregar}>
              Recarregar a ficha
            </Botao>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Botao type="submit" disabled={enviando} aria-busy={enviando}>
          {enviando ? "Salvando..." : "Salvar"}
        </Botao>
        <Botao type="button" variante="secundaria" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
