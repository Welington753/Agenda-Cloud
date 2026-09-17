"use client";

// Escolha do cliente para a reserva (Lote 6D.5): buscar um já cadastrado ou
// cadastrar o mínimo necessário.
//
// A busca é sempre por termo (nunca "listar todos") e escopada pelo tenant no
// servidor. O cliente NOVO não é gravado aqui: os dados sobem junto com a
// reserva, para os dois nascerem na mesma transação — se a reserva falhar,
// nenhum cliente fica para trás.
import { useEffect, useRef, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import * as agendamentosApi from "@/lib/api/appointments-api";
import type { ClienteReal, DadosClienteNovo, SelecaoDeCliente } from "@/lib/api/appointments-api";
import { Botao } from "@/components/ui/button";

interface SeletorClienteProps {
  tenantId: string;
  selecao: SelecaoDeCliente | null;
  clienteEscolhido: ClienteReal | null;
  desabilitado: boolean;
  aoEscolherExistente: (cliente: ClienteReal) => void;
  aoPreencherNovo: (dados: DadosClienteNovo | null) => void;
}

export function SeletorCliente({
  tenantId,
  selecao,
  clienteEscolhido,
  desabilitado,
  aoEscolherExistente,
  aoPreencherNovo,
}: SeletorClienteProps) {
  const [modo, setModo] = useState<"buscar" | "novo">("buscar");
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ClienteReal[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  /** Tenant vigente conforme o render mais recente — resposta atrasada de um
   * estabelecimento anterior nunca escreve na tela do novo. */
  const tenantRef = useRef(tenantId);
  useEffect(() => {
    tenantRef.current = tenantId;
    setResultados([]);
    setTermo("");
  }, [tenantId]);

  // Os dados do cliente novo sobem para o formulário a cada tecla — nada é
  // gravado aqui, só informado a quem monta o corpo da reserva.
  useEffect(() => {
    if (modo !== "novo") return;
    const pronto = nome.trim().length > 0 && whatsapp.trim().length > 0;
    aoPreencherNovo(pronto ? { name: nome.trim(), whatsapp: whatsapp.trim() } : null);
  }, [modo, nome, whatsapp, aoPreencherNovo]);

  async function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    if (termo.trim().length < 2 || buscando) return;

    const tenantDaChamada = tenantRef.current;
    setBuscando(true);
    setErroBusca(null);
    const resultado = await agendamentosApi.buscarClientes(tenantDaChamada, termo.trim());
    if (tenantRef.current !== tenantDaChamada) return;
    setBuscando(false);

    if (!resultado.ok) {
      setErroBusca("Não foi possível buscar agora. Tente novamente.");
      setResultados([]);
      return;
    }
    setResultados(resultado.dados);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Botao
          type="button"
          variante={modo === "buscar" ? "primaria" : "secundaria"}
          tamanho="sm"
          disabled={desabilitado}
          onClick={() => {
            setModo("buscar");
            aoPreencherNovo(null);
          }}
        >
          <Search size={14} className="mr-1" />
          Buscar cliente
        </Botao>
        <Botao
          type="button"
          variante={modo === "novo" ? "primaria" : "secundaria"}
          tamanho="sm"
          disabled={desabilitado}
          onClick={() => setModo("novo")}
        >
          <UserPlus size={14} className="mr-1" />
          Cadastrar novo
        </Botao>
      </div>

      {modo === "buscar" && (
        <div className="space-y-2">
          {/* `div`, não `form`: um formulário aninhado no da reserva faria o
              Enter da busca enviar a reserva inteira. */}
          <div className="flex gap-2">
            <input
              type="search"
              aria-label="Buscar cliente por nome ou telefone"
              value={termo}
              disabled={desabilitado}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void buscar(e);
                }
              }}
              placeholder="Nome ou telefone"
              className="flex-1 rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
            <Botao
              type="button"
              variante="secundaria"
              disabled={desabilitado || buscando || termo.trim().length < 2}
              onClick={(e) => void buscar(e)}
            >
              {buscando ? "Buscando..." : "Buscar"}
            </Botao>
          </div>

          {erroBusca && (
            <p role="alert" className="text-xs text-[color:var(--color-danger)]">
              {erroBusca}
            </p>
          )}

          {resultados.length > 0 && (
            <ul className="space-y-1" data-testid="resultados-clientes">
              {resultados.map((cliente) => {
                const escolhido =
                  selecao?.mode === "existing" && selecao.consumerId === cliente.id;
                return (
                  <li key={cliente.id}>
                    <button
                      type="button"
                      disabled={desabilitado}
                      onClick={() => aoEscolherExistente(cliente)}
                      className={`w-full rounded-[var(--radius-control)] border px-3 py-2 text-left text-sm ${
                        escolhido ? "border-accent bg-paper-muted" : "border-border"
                      }`}
                    >
                      <span className="font-medium text-ink">{cliente.name}</span>
                      <span className="ml-2 text-xs text-ink-soft">{cliente.whatsapp}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!buscando && termo.trim().length >= 2 && resultados.length === 0 && !erroBusca && (
            <p className="text-xs text-ink-soft">
              Nenhum cliente encontrado. Use &quot;Cadastrar novo&quot; para criar um.
            </p>
          )}

          {clienteEscolhido && selecao?.mode === "existing" && (
            <p className="text-xs text-ink-soft">
              Cliente selecionado: <strong className="text-ink">{clienteEscolhido.name}</strong>
            </p>
          )}
        </div>
      )}

      {modo === "novo" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cliente-nome" className="mb-1 block text-xs font-medium text-ink-soft">
              Nome do cliente
            </label>
            <input
              id="cliente-nome"
              value={nome}
              disabled={desabilitado}
              onChange={(e) => setNome(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>
          <div>
            <label
              htmlFor="cliente-whatsapp"
              className="mb-1 block text-xs font-medium text-ink-soft"
            >
              WhatsApp
            </label>
            <input
              id="cliente-whatsapp"
              value={whatsapp}
              disabled={desabilitado}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="(11) 90000-0000"
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>
          <p className="text-xs text-ink-soft sm:col-span-2">
            O cliente é cadastrado junto com a reserva. Cadastrar um cliente não cria login nem dá
            acesso ao sistema.
          </p>
        </div>
      )}
    </div>
  );
}
