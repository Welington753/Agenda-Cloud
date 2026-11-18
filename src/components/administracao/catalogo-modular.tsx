"use client";

// Catálogo da assinatura modular no portal. É a ÚNICA tela que edita o
// catálogo: nome, descrição e preço mensal padrão do Agendamento essencial e
// de cada adicional, inclusive os em desenvolvimento e planejados (que
// continuam sem poder ser contratados). A disponibilidade é só leitura: muda
// quando o recurso é liberado no código. Mudar o preço padrão não reajusta
// assinaturas existentes; renomear não muda o que o item libera. Valores de
// exemplo nunca são gravados por padrão: sem preço, aparece "a definir".
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
import {
  DESCRICAO_MAXIMA,
  formularioInicial,
  itensDoCatalogo,
  mensagemDeSucesso,
  MOTIVO_MAXIMO,
  NOME_MAXIMO,
  textoDaDisponibilidade,
  validarItem,
  type FormularioDoItem,
  type ItemDoCatalogo,
} from "@/lib/administracao/catalogo-modular";
import { dataCadastro } from "@/lib/administracao/contratos";
import { reais } from "@/lib/administracao/validade";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";
const ERRO = "mt-1 block text-xs text-[color:var(--color-danger)]";

export function CatalogoModular() {
  const { estado, recarregar } = useLeituraPlataforma("/platform/addons", ehCatalogoAssinatura);
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(recarregar);
  const [edicao, setEdicao] = useState<ItemDoCatalogo | null>(null);
  const [form, setForm] = useState<FormularioDoItem>({ nome: "", descricao: "", preco: "", motivo: "" });
  const [chave, setChave] = useState(novaChaveDeFormulario);
  const [tentou, setTentou] = useState(false);

  if (estado.status !== "pronto") return <EstadoLeitura estado={estado} recarregar={recarregar} />;
  const catalogo = estado.dados;
  const itens = itensDoCatalogo(catalogo);
  const validacao = edicao ? validarItem(edicao, form) : null;
  const erros = tentou ? (validacao?.erros ?? {}) : {};

  function abrir(item: ItemDoCatalogo) {
    setChave(novaChaveDeFormulario());
    setForm(formularioInicial(item));
    setTentou(false);
    setEdicao(item);
  }

  const mudar = (campo: keyof FormularioDoItem, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));

  async function salvar() {
    setTentou(true);
    if (!edicao || !validacao?.corpo) return;
    const alvo = edicao;
    const corpo = validacao.corpo;
    // A confirmação de senha abre outra janela: esta fecha antes e volta, com
    // o que foi digitado, se o servidor recusar.
    setEdicao(null);
    const ok = await executar(
      () => executarSensivel(() => acaoAdministrativa(alvo.caminho, "PUT", { requestKey: chave, ...corpo })),
      mensagemDeSucesso(alvo, corpo),
    );
    if (!ok) {
      setChave(novaChaveDeFormulario());
      setEdicao(alvo);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="titulo-modular">
      <div>
        <h2 id="titulo-modular" className="text-xl font-bold">
          Assinatura modular
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Nome, descrição e preço mensal padrão do essencial e de cada adicional. Só adicionais disponíveis podem ser
          contratados; os em desenvolvimento e planejados aparecem desativados na criação e não entram no total. Mudar um
          preço padrão não reajusta assinaturas existentes.
        </p>
      </div>
      {!edicao && <Retorno mensagem={mensagem} />}
      <ul className="grid gap-3 md:grid-cols-2" data-testid="catalogo-modular">
        {itens.map((item) => (
          <li key={item.code} className="min-w-0">
            <Cartao className="h-full">
              <CartaoCorpo className="flex h-full flex-col gap-2" data-testid={`item-catalogo-${item.code}`}>
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <span className="min-w-0 break-words">{item.name}</span>
                  {item.availability === null ? (
                    <Badge cor="sucesso">Sempre incluído</Badge>
                  ) : (
                    <Badge cor={item.availability === "AVAILABLE" ? "sucesso" : "neutro"}>
                      {ROTULO_DISPONIBILIDADE[item.availability]}
                    </Badge>
                  )}
                </p>
                <p className="break-words text-xs text-ink-soft">{item.description}</p>
                <p className="text-sm" data-testid={`preco-modular-${item.tipo === "ESSENCIAL" ? "base" : item.code}`}>
                  {item.priceCents === null ? <Badge cor="aviso">A definir</Badge> : <strong>{reais(item.priceCents)} / mês</strong>}
                </p>
                {item.availability !== null && item.availability !== "AVAILABLE" && (
                  <p className="text-xs text-ink-soft">{textoDaDisponibilidade(item)}</p>
                )}
                {catalogo.canManage && (
                  <Botao
                    variante="secundaria"
                    className="mt-auto min-h-11 w-full"
                    disabled={ocupado}
                    aria-label={`Editar ${item.name}`}
                    data-testid={`editar-${item.code}`}
                    onClick={() => abrir(item)}
                  >
                    Editar
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
        titulo={`Editar ${edicao?.name ?? ""}`}
        rodape={
          <>
            <Botao variante="secundaria" className="min-h-11" onClick={() => setEdicao(null)}>
              Cancelar
            </Botao>
            <Botao
              className="min-h-11"
              disabled={ocupado || !validacao?.mudou || (tentou && !validacao.corpo)}
              onClick={() => void salvar()}
              data-testid="salvar-item-catalogo"
            >
              Salvar
            </Botao>
          </>
        }
      >
        {edicao && (
          <form
            className="space-y-3"
            data-testid="form-item-catalogo"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void salvar();
            }}
          >
            <Retorno mensagem={mensagem} />
            <p className="text-sm text-ink-soft">{textoDaDisponibilidade(edicao)}</p>
            <label className="block text-sm font-medium">
              Nome
              <input
                className={CAMPO}
                maxLength={NOME_MAXIMO}
                value={form.nome}
                onChange={(e) => mudar("nome", e.target.value)}
                aria-invalid={!!erros.nome}
              />
              {erros.nome && <span className={ERRO}>{erros.nome}</span>}
            </label>
            <label className="block text-sm font-medium">
              Descrição
              <textarea
                className={`${CAMPO} py-2`}
                rows={3}
                maxLength={DESCRICAO_MAXIMA}
                value={form.descricao}
                // Uma linha só: aparece nos cartões e na criação do estabelecimento.
                onChange={(e) => mudar("descricao", e.target.value.replace(/\s*\n\s*/g, " "))}
                aria-invalid={!!erros.descricao}
              />
              {erros.descricao && <span className={ERRO}>{erros.descricao}</span>}
            </label>
            <label className="block text-sm font-medium">
              Preço mensal padrão (R$)
              <input
                className={CAMPO}
                inputMode="decimal"
                placeholder={edicao.priceCents === null ? "A definir" : undefined}
                value={form.preco}
                onChange={(e) => mudar("preco", e.target.value)}
                aria-invalid={!!erros.preco}
              />
              {erros.preco && <span className={ERRO}>{erros.preco}</span>}
            </label>
            <p className="rounded-lg border border-border bg-paper-muted p-3 text-xs" data-testid="aviso-preco-padrao">
              O preço padrão vale para as próximas contratações. Não reajusta assinaturas existentes nem muda pagamentos
              ou períodos já registrados. Renomear não muda o que o item libera nem quem já o contratou.
            </p>
            <label className="block text-sm font-medium">
              Motivo (opcional, fica no histórico)
              <input
                className={CAMPO}
                maxLength={MOTIVO_MAXIMO}
                value={form.motivo}
                onChange={(e) => mudar("motivo", e.target.value)}
                aria-invalid={!!erros.motivo}
              />
              {erros.motivo && <span className={ERRO}>{erros.motivo}</span>}
            </label>
          </form>
        )}
      </Modal>
    </section>
  );
}
