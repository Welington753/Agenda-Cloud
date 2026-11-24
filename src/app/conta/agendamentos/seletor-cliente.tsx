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
  // Depois de escolher um cliente da busca, a lista recolhe e fica só o
  // escolhido com "Trocar"; "Trocar" reabre a busca (termo e resultados de
  // antes, o escolhido marcado) sem desfazer a escolha até outro ser tocado.
  const [buscaAberta, setBuscaAberta] = useState(false);
  const campoBuscaRef = useRef<HTMLInputElement>(null);
  const trocarRef = useRef<HTMLButtonElement>(null);
  // O elemento tocado some ao recolher/reabrir: o foco vai para o equivalente.
  const focarDepois = useRef<"trocar" | "busca" | null>(null);
  useEffect(() => {
    if (focarDepois.current === "trocar") trocarRef.current?.focus();
    if (focarDepois.current === "busca") campoBuscaRef.current?.focus();
    focarDepois.current = null;
  });
  const escolhido = clienteEscolhido && selecao?.mode === "existing" ? clienteEscolhido : null;
  const recolhida = !!escolhido && !buscaAberta;

  /** Tenant vigente conforme o render mais recente — resposta atrasada de um
   * estabelecimento anterior nunca escreve na tela do novo. */
  const tenantRef = useRef(tenantId);
  // Busca mais recente vence (mesma regra de lib/clientes/use-clientes-reais.ts):
  // cada busca leva um número de sequência e aborta a anterior. Uma resposta
  // cuja sequência já não é a vigente não toca em resultados, erro nem
  // carregamento.
  const sequenciaRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  /** Invalida a busca em voo: a resposta dela, se chegar, é descartada. */
  function invalidarBusca() {
    sequenciaRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }

  useEffect(() => {
    tenantRef.current = tenantId;
    invalidarBusca();
    setResultados([]);
    setTermo("");
    setBuscando(false);
    setErroBusca(null);
    setBuscaAberta(false);
  }, [tenantId]);

  useEffect(() => () => invalidarBusca(), []);

  // Os dados do cliente novo sobem para o formulário a cada tecla — nada é
  // gravado aqui, só informado a quem monta o corpo da reserva.
  useEffect(() => {
    if (modo !== "novo") return;
    const pronto = nome.trim().length > 0 && whatsapp.trim().length > 0;
    aoPreencherNovo(pronto ? { name: nome.trim(), whatsapp: whatsapp.trim() } : null);
  }, [modo, nome, whatsapp, aoPreencherNovo]);

  async function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    // Buscar de novo com uma busca em voo é permitido: a nova substitui a
    // antiga, nunca o contrário.
    if (termo.trim().length < 2) return;

    invalidarBusca();
    const sequencia = sequenciaRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const tenantDaChamada = tenantRef.current;
    setBuscando(true);
    setErroBusca(null);
    const resultado = await agendamentosApi.buscarClientes(
      tenantDaChamada,
      termo.trim(),
      controller.signal,
    );
    if (sequencia !== sequenciaRef.current || tenantRef.current !== tenantDaChamada) return;
    controllerRef.current = null;
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
          variante="secundaria"
          tamanho="sm"
          // Alternância, não ação principal: escolhido fica marcado sem virar
          // o botão claro da tela.
          aria-pressed={modo === "buscar"}
          className={`max-sm:min-h-11 ${modo === "buscar" ? "bg-accent-soft font-semibold" : ""}`}
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
          variante="secundaria"
          tamanho="sm"
          aria-pressed={modo === "novo"}
          className={`max-sm:min-h-11 ${modo === "novo" ? "bg-accent-soft font-semibold" : ""}`}
          disabled={desabilitado}
          onClick={() => setModo("novo")}
        >
          <UserPlus size={14} className="mr-1" />
          Cadastrar novo
        </Botao>
      </div>

      {modo === "buscar" && recolhida && escolhido && (
        <div
          data-testid="cliente-escolhido"
          className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-accent bg-paper-muted px-3 py-2"
        >
          <div className="min-w-0">
            <p className="text-sm text-ink-soft">
              Cliente selecionado: <strong className="break-words text-ink">{escolhido.name}</strong>
            </p>
            {escolhido.whatsapp && (
              <p data-testid="telefone-cliente-escolhido" className="text-xs text-ink-soft tabular-nums">
                {escolhido.whatsapp}
              </p>
            )}
          </div>
          <Botao
            ref={trocarRef}
            type="button"
            variante="secundaria"
            tamanho="sm"
            className="shrink-0 max-sm:min-h-11"
            aria-label={`Trocar cliente ${escolhido.name}`}
            disabled={desabilitado}
            onClick={() => {
              focarDepois.current = "busca";
              setBuscaAberta(true);
            }}
          >
            Trocar
          </Botao>
        </div>
      )}

      {modo === "buscar" && !recolhida && (
        <div className="space-y-2">
          {/* `div`, não `form`: um formulário aninhado no da reserva faria o
              Enter da busca enviar a reserva inteira. */}
          <div className="flex gap-2">
            <input
              ref={campoBuscaRef}
              type="search"
              aria-label="Buscar cliente por nome ou telefone"
              value={termo}
              disabled={desabilitado}
              onChange={(e) => {
                setTermo(e.target.value);
                // Termo que deixou de valer como busca: a busca em voo
                // perde a vez e a tela volta ao estado sem busca.
                if (e.target.value.trim().length < 2) {
                  invalidarBusca();
                  setResultados([]);
                  setErroBusca(null);
                  setBuscando(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void buscar(e);
                }
              }}
              placeholder="Nome ou telefone"
              className="flex-1 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 py-2 text-base text-ink max-sm:min-h-11 sm:text-sm"
            />
            <Botao
              type="button"
              variante="secundaria"
              className="max-sm:min-h-11"
              disabled={desabilitado || termo.trim().length < 2}
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
                // Identificação sempre pelo id: homônimos e telefones iguais
                // são cadastros distintos.
                const marcado = selecao?.mode === "existing" && selecao.consumerId === cliente.id;
                return (
                  <li key={cliente.id}>
                    <button
                      type="button"
                      aria-pressed={marcado}
                      disabled={desabilitado}
                      onClick={() => {
                        aoEscolherExistente(cliente);
                        focarDepois.current = "trocar";
                        setBuscaAberta(false);
                      }}
                      className={`w-full rounded-[var(--radius-control)] border px-3 py-2 text-left text-sm max-sm:min-h-11 ${
                        marcado ? "border-accent bg-paper-muted" : "border-border"
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

          {/* Busca reaberta por "Trocar": a escolha anterior continua valendo
              até outro cliente ser tocado. */}
          {escolhido && (
            <p className="text-xs text-ink-soft">
              Cliente selecionado: <strong className="text-ink">{escolhido.name}</strong>
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
              className="w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3 py-2 text-base text-ink max-sm:min-h-11 sm:text-sm"
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
              inputMode="tel"
              autoComplete="tel"
              value={whatsapp}
              disabled={desabilitado}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="(11) 90000-0000"
              className="w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3 py-2 text-base text-ink max-sm:min-h-11 sm:text-sm"
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
