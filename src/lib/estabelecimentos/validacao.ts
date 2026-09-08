// Validações puras e testáveis da identidade pública de um estabelecimento
// (slug, logo, fotos, cores). São a barreira real — o repository chama estas
// funções antes de gravar, nunca confia só na tela que chamou (mesma
// disciplina já aplicada a `comissaoRegraRepository` e a `access-control.ts`).

import type { Estabelecimento, IdentidadeVisual } from "@/lib/types";

export interface ResultadoValidacao {
  valido: boolean;
  motivo?: string;
}

/** Endereços que o Next.js já usa (ou pode vir a usar) na raiz do site — nunca
 * podem virar o slug de um estabelecimento, ou a rota pública `/[slug]`
 * coincidiria com uma rota do sistema. */
export const SLUGS_RESERVADOS = [
  "login",
  "master",
  "painel",
  "profissional",
  "403",
  "api",
  "admin",
  "configuracoes",
  "agendar",
  "onboarding",
] as const;

const FORMATO_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Normaliza texto livre num slug candidato: minúsculas, sem acento, só
 * letras/números/hífen, sem hífen duplicado nem nas pontas. Não garante
 * unicidade nem que o resultado não seja reservado — ver `validarFormatoSlug`. */
export function normalizarSlug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validarFormatoSlug(slug: string): ResultadoValidacao {
  if (!slug.trim()) {
    return { valido: false, motivo: "Informe o endereço público." };
  }
  if (!FORMATO_SLUG.test(slug)) {
    return {
      valido: false,
      motivo:
        "Use apenas letras minúsculas, números e hífen — sem espaços, acentos, maiúsculas ou hífen duplicado/nas pontas.",
    };
  }
  if ((SLUGS_RESERVADOS as readonly string[]).includes(slug)) {
    return { valido: false, motivo: `O endereço "/${slug}" é reservado pelo sistema e não pode ser usado.` };
  }
  return { valido: true };
}

/** Barreira completa: formato + reservado + unicidade entre estabelecimentos.
 * `ignorarTenantId` permite validar o próprio slug de um tenant ao salvar de novo. */
export function validarSlugEstabelecimento(
  slug: string,
  estabelecimentos: Pick<Estabelecimento, "slug" | "tenantId">[],
  ignorarTenantId?: string
): ResultadoValidacao {
  const formato = validarFormatoSlug(slug);
  if (!formato.valido) return formato;
  const emUso = estabelecimentos.some((e) => e.slug === slug && e.tenantId !== ignorarTenantId);
  if (emUso) {
    return { valido: false, motivo: `O endereço "/${slug}" já está em uso por outro estabelecimento.` };
  }
  return { valido: true };
}

export const TIPOS_LOGO_ACEITOS = ["image/png", "image/jpeg", "image/webp"] as const;
export const TAMANHO_MAXIMO_LOGO_BYTES = 500 * 1024;

export interface ArquivoParaValidar {
  type: string;
  size: number;
}

export function validarArquivoLogo(arquivo: ArquivoParaValidar): ResultadoValidacao {
  if (!(TIPOS_LOGO_ACEITOS as readonly string[]).includes(arquivo.type)) {
    return {
      valido: false,
      motivo: "Envie um arquivo PNG, JPEG ou WEBP. Outros formatos (incluindo SVG) não são aceitos.",
    };
  }
  if (arquivo.size > TAMANHO_MAXIMO_LOGO_BYTES) {
    return { valido: false, motivo: "O arquivo excede o tamanho máximo de 500 KB." };
  }
  return { valido: true };
}

const FORMATO_COR_HEX = /^#[0-9a-fA-F]{6}$/;

export function validarCorHex(cor: string): ResultadoValidacao {
  if (!FORMATO_COR_HEX.test(cor)) {
    return { valido: false, motivo: `Cor inválida: "${cor}". Use o formato #RRGGBB.` };
  }
  return { valido: true };
}

const FORMATO_DATA_URL_IMAGEM = /^data:image\/(png|jpeg|jpg|webp);base64,/;

/** Aceita só link seguro (`https://`) ou Data URL de imagem já validada (o
 * formato gerado pelo upload local de logo/fotos desta demonstração). */
export function validarUrlFoto(url: string): ResultadoValidacao {
  if (url.startsWith("https://")) return { valido: true };
  if (FORMATO_DATA_URL_IMAGEM.test(url)) return { valido: true };
  return {
    valido: false,
    motivo: `URL de foto inválida: "${url}". Use um link seguro (https://) ou uma imagem enviada na própria tela.`,
  };
}

/** Valida os campos de aparência inteiros antes de persistir. */
export function validarIdentidadeVisual(identidade: IdentidadeVisual): ResultadoValidacao {
  for (const cor of [identidade.corPrincipal, identidade.corSecundaria, identidade.corDestaque]) {
    const resultado = validarCorHex(cor);
    if (!resultado.valido) return resultado;
  }
  for (const foto of identidade.fotos) {
    const resultado = validarUrlFoto(foto);
    if (!resultado.valido) return resultado;
  }
  if (identidade.logoUrl) {
    const resultado = validarUrlFoto(identidade.logoUrl);
    if (!resultado.valido) return { valido: false, motivo: "Logo inválido: envie um arquivo válido (PNG, JPEG ou WEBP)." };
  }
  return { valido: true };
}
