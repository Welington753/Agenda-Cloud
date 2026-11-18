// Edição do catálogo modular em Planos e adicionais (única tela que edita o
// catálogo): itens que a página mostra, validação do formulário "Editar" e o
// corpo enviado. O servidor confere tudo de novo
// (docs/plans/edicao-catalogo-modular.md).
//
// - Nome, descrição e preço mensal padrão do essencial e de cada adicional,
//   inclusive os em desenvolvimento e planejados (que continuam sem poder
//   ser contratados).
// - Mudar o preço padrão não reajusta assinaturas existentes.
// - Um preço já definido não volta a ficar pendente.
import { centavosDe, textoDoValor } from "./validade";
import { ROTULO_DISPONIBILIDADE, type CatalogoAssinatura, type Disponibilidade } from "./assinatura";

export const NOME_MAXIMO = 80;
export const DESCRICAO_MAXIMA = 300;
export const MOTIVO_MAXIMO = 300;
/** Mesmo teto do servidor (R$ 1.000.000,00). */
export const PRECO_MAXIMO_CENTAVOS = 100_000_000;

export interface ItemDoCatalogo {
  /** Código do adicional ou o id do plano do essencial. */
  code: string;
  tipo: "ESSENCIAL" | "ADICIONAL";
  name: string;
  description: string;
  priceCents: number | null;
  /** `null` no essencial (sempre incluído). */
  availability: Disponibilidade | null;
  caminho: string;
}

/** Essencial primeiro, depois os adicionais na ordem do catálogo. */
export function itensDoCatalogo(catalogo: CatalogoAssinatura): ItemDoCatalogo[] {
  return [
    {
      code: catalogo.essential.planId,
      tipo: "ESSENCIAL",
      name: catalogo.essential.name,
      description: catalogo.essential.description,
      priceCents: catalogo.essential.priceCents,
      availability: null,
      caminho: "/platform/catalog/essential",
    },
    ...catalogo.addons.map((a) => ({
      code: a.code,
      tipo: "ADICIONAL" as const,
      name: a.name,
      description: a.description,
      priceCents: a.priceCents,
      availability: a.availability,
      caminho: `/platform/catalog/addons/${encodeURIComponent(a.code)}`,
    })),
  ];
}

/** O que dizer sobre a contratação do item. */
export function textoDaDisponibilidade(item: ItemDoCatalogo): string {
  if (item.tipo === "ESSENCIAL") return "Sempre incluído: é a base obrigatória de toda assinatura.";
  if (item.availability === "AVAILABLE") return "Disponível para contratação.";
  const situacao = ROTULO_DISPONIBILIDADE[item.availability ?? "PLANNED"].toLowerCase();
  return `Não pode ser contratado enquanto estiver ${situacao}.`;
}

export interface FormularioDoItem {
  nome: string;
  descricao: string;
  preco: string;
  motivo: string;
}

export interface ErrosDoItem {
  nome?: string;
  descricao?: string;
  preco?: string;
  motivo?: string;
}

export interface CorpoDoItem {
  expected: { name: string; description: string; priceCents: number | null };
  name: string;
  description: string;
  priceCents: number | null;
  reason?: string;
}

export function formularioInicial(item: ItemDoCatalogo): FormularioDoItem {
  return {
    nome: item.name,
    descricao: item.description,
    preco: item.priceCents === null ? "" : textoDoValor(item.priceCents),
    motivo: "",
  };
}

const controle = /\p{Cc}/u;

/** Erros por campo, se algo mudou e o corpo pronto para enviar (sem a chave). */
export function validarItem(
  item: ItemDoCatalogo,
  form: FormularioDoItem,
): { erros: ErrosDoItem; mudou: boolean; corpo: CorpoDoItem | null } {
  const erros: ErrosDoItem = {};
  const nome = form.nome.trim();
  const descricao = form.descricao.trim();
  const motivo = form.motivo.trim();

  if (nome.length < 2) erros.nome = "Informe um nome com pelo menos 2 caracteres.";
  else if (nome.length > NOME_MAXIMO) erros.nome = `O nome pode ter até ${NOME_MAXIMO} caracteres.`;
  else if (controle.test(nome)) erros.nome = "O nome não pode ter quebras de linha.";

  if (descricao.length < 3) erros.descricao = "Informe uma descrição com pelo menos 3 caracteres.";
  else if (descricao.length > DESCRICAO_MAXIMA) erros.descricao = `A descrição pode ter até ${DESCRICAO_MAXIMA} caracteres.`;
  else if (controle.test(descricao)) erros.descricao = "A descrição não pode ter quebras de linha.";

  let priceCents: number | null = null;
  if (form.preco.trim() === "") {
    if (item.priceCents !== null) erros.preco = "Informe o preço mensal padrão: um preço já definido não volta a ficar pendente.";
  } else {
    priceCents = centavosDe(form.preco);
    if (priceCents === null) erros.preco = "Valor inválido. Use, por exemplo, 29,90.";
    else if (priceCents > PRECO_MAXIMO_CENTAVOS) erros.preco = "Valor acima do máximo permitido.";
  }

  if (motivo && motivo.length < 3) erros.motivo = "Escreva o motivo com pelo menos 3 caracteres ou deixe em branco.";
  else if (motivo.length > MOTIVO_MAXIMO) erros.motivo = `O motivo pode ter até ${MOTIVO_MAXIMO} caracteres.`;

  const mudou =
    nome !== item.name || descricao !== item.description || (erros.preco === undefined && priceCents !== item.priceCents);
  const valido = Object.keys(erros).length === 0;
  return {
    erros,
    mudou,
    corpo:
      valido && mudou
        ? {
            expected: { name: item.name, description: item.description, priceCents: item.priceCents },
            name: nome,
            description: descricao,
            priceCents,
            ...(motivo ? { reason: motivo } : {}),
          }
        : null,
  };
}

/** Mensagem de sucesso, dizendo o que não muda. */
export function mensagemDeSucesso(item: ItemDoCatalogo, corpo: CorpoDoItem): string {
  const precoMudou = corpo.priceCents !== item.priceCents;
  return (
    `${corpo.name} atualizado no catálogo.` +
    (precoMudou ? " O novo preço vale para as próximas contratações; assinaturas existentes não mudam." : "")
  );
}
