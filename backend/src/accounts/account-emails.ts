// Textos dos e-mails de conta. O link leva o token no FRAGMENTO (`#t=`): o
// navegador não envia o fragmento ao servidor, então ele não aparece em log
// de acesso do site, nem no `Referer`. A página lê o fragmento e manda o
// token no corpo de um POST explícito.
//
// Nenhum e-mail leva senha. Quem recebe define a própria senha na página.
//
// Cada mensagem tem HTML (layout de uma coluna, estilos inline, que funciona
// no celular sem depender de media query) e texto simples com o mesmo
// conteúdo. Nome, e-mail e estabelecimento vêm de cadastro: são limpos de
// caracteres de controle e escapados no HTML. A marca vem de `email/marca.ts`.
import type { EmailMessage } from '../email/email-sender.js';
import { MARCA } from '../email/marca.js';
import { isValidAccountTokenFormat } from './account-token.js';

const escapar = (texto: string) =>
  texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Controles C0/C1, separadores de linha e marcas de direção (que deixariam um
// nome embaralhar o texto ao redor). Acentos e emoji passam intactos.
// oxlint-disable-next-line no-control-regex
const CARACTERES_INVISIVEIS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** Texto de cadastro pronto para o e-mail: uma linha só, sem controles. */
export function limparTexto(texto: string): string {
  return texto.replace(CARACTERES_INVISIVEIS, ' ').replace(/\s+/g, ' ').trim();
}

function primeiroNome(nome: string): string {
  return limparTexto(nome).split(' ')[0] ?? '';
}

/** Link do e-mail. Recusa (com erro) token fora do formato e endereço de
 * frontend que não seja uma origem http(s) simples: nunca sai um link quebrado
 * ou apontando para outro lugar. */
function montarLink(frontendUrl: string, caminho: '/convite' | '/redefinir-senha', token: string): string {
  if (!isValidAccountTokenFormat(token)) throw new Error('Token do link em formato inválido.');
  const url = new URL(frontendUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('FRONTEND_URL não serve para montar o link do e-mail.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${caminho}`;
  url.hash = `t=${token}`;
  return url.toString();
}

export function linkDeConvite(frontendUrl: string, token: string): string {
  return montarLink(frontendUrl, '/convite', token);
}

export function linkDeRedefinicao(frontendUrl: string, token: string): string {
  return montarLink(frontendUrl, '/redefinir-senha', token);
}

const MINUTO_MS = 60_000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;

/** Validade escrita por extenso, arredondada para baixo: o e-mail nunca
 * promete mais tempo do que o link tem. */
export function descreverValidade(ms: number): string {
  if (ms >= 2 * DIA_MS && ms % DIA_MS === 0) return `${ms / DIA_MS} dias`;
  if (ms >= HORA_MS) {
    const horas = Math.floor(ms / HORA_MS);
    return horas === 1 ? '1 hora' : `${horas} horas`;
  }
  const minutos = Math.max(1, Math.floor(ms / MINUTO_MS));
  return minutos === 1 ? '1 minuto' : `${minutos} minutos`;
}

/** Onde a ação aparece: botão no HTML, link no texto simples. */
type Meio = 'botão' | 'link';

interface Conteudo {
  to: { email: string; name: string };
  assunto: string;
  /** Linha que o app de e-mail mostra ao lado do assunto. */
  previa: string;
  titulo: string;
  corpo: (meio: Meio) => string[];
  acao: { rotulo: string; link: string };
  validade: string;
  aviso: string;
}

function mensagem(c: Conteudo): EmailMessage {
  const nome = primeiroNome(c.to.name);
  const saudacao = nome ? `Olá, ${nome}!` : 'Olá!';
  const to = { email: c.to.email, name: limparTexto(c.to.name) };
  const rodape = `Mensagem automática do ${MARCA.nome}, enviada para ${c.to.email}.`;

  const text = [
    saudacao,
    '',
    ...c.corpo('link').flatMap((p) => [p, '']),
    `${c.acao.rotulo}:`,
    c.acao.link,
    '',
    c.validade,
    '',
    c.aviso,
    '',
    '--',
    rodape,
  ].join('\n');

  const k = MARCA.cores;
  const fonte = 'font-family:Arial,Helvetica,sans-serif;';
  const p = (texto: string, estilo = '') => `<p style="margin:0 0 16px;${estilo}">${escapar(texto)}</p>`;
  const pequeno = `font-size:14px;line-height:1.5;color:${k.textoSuave};`;
  const link = escapar(c.acao.link);
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapar(c.assunto)}</title>
</head>
<body style="margin:0;padding:0;background:${k.fundo};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(c.previa)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${k.fundo};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 12px;${fonte}font-size:15px;font-weight:bold;color:${k.destaque};">${escapar(MARCA.nome)}</td></tr>
<tr><td style="background:${k.cartao};border:1px solid ${k.borda};border-radius:12px;padding:28px 24px;${fonte}font-size:16px;line-height:1.6;color:${k.texto};">
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:${k.texto};">${escapar(c.titulo)}</h1>
${[saudacao, ...c.corpo('botão')].map((t) => p(t)).join('\n')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
<tr><td style="border-radius:8px;background:${k.destaque};">
<a href="${link}" style="display:inline-block;padding:14px 28px;${fonte}font-size:16px;font-weight:bold;line-height:1.2;color:${k.sobreDestaque};text-decoration:none;border-radius:8px;">${escapar(c.acao.rotulo)}</a>
</td></tr>
</table>
${p(c.validade, pequeno)}
<p style="margin:0 0 20px;${pequeno}">Se o botão não funcionar, copie e cole este endereço no navegador:<br><a href="${link}" style="color:${k.destaque};word-break:break-all;">${link}</a></p>
<hr style="border:0;border-top:1px solid ${k.borda};margin:0 0 16px;">
${p(c.aviso, `${pequeno}margin:0;`)}
</td></tr>
<tr><td style="padding:16px 4px 0;${fonte}font-size:12px;line-height:1.5;color:${k.textoSuave};">${escapar(rodape)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { to, subject: limparTexto(c.assunto), text, html };
}

export interface ConviteParaEmail {
  targetName: string;
  targetEmail: string;
  /** Estabelecimento do vínculo, ou `null` num convite de plataforma. */
  tenantName: string | null;
  /** A conta já tem senha: o aceite pede a senha atual, não cria outra. */
  accountExists: boolean;
  /** Reenvio: este link substitui todos os anteriores do mesmo convite. */
  resent: boolean;
  /** Validade do link emitido (`expires_at` menos o instante da emissão). */
  validityMs: number;
}

export function emailDeConvite(convite: ConviteParaEmail, link: string): EmailMessage {
  const tenant = convite.tenantName === null ? null : limparTexto(convite.tenantName) || 'o estabelecimento';
  const assunto = tenant ? `Convite para acessar ${tenant}` : `Convite para a administração do ${MARCA.nome}`;
  return mensagem({
    to: { email: convite.targetEmail, name: convite.targetName },
    assunto: convite.resent ? `Novo link: ${assunto.charAt(0).toLowerCase()}${assunto.slice(1)}` : assunto,
    previa: convite.accountExists
      ? 'Aceite o convite com a senha que você já usa.'
      : `Crie sua senha para começar a usar o ${MARCA.nome}.`,
    titulo: tenant ? `Convite para ${tenant}` : 'Convite para a administração da plataforma',
    corpo: (meio) => [
      tenant
        ? `Você recebeu um convite para acessar ${tenant} pelo ${MARCA.nome}.`
        : `Você recebeu um convite para participar da administração da plataforma ${MARCA.nome}.`,
      ...(convite.resent ? ['Este é um novo link para o mesmo convite. Os links enviados antes não funcionam mais.'] : []),
      convite.accountExists
        ? `Você já tem uma conta no ${MARCA.nome}, então não precisa criar outra senha. Para aceitar, use o ${meio} abaixo e confirme com a senha que você já usa.`
        : `Para começar, crie sua senha pelo ${meio} abaixo.`,
    ],
    acao: { rotulo: convite.accountExists ? 'Aceitar o convite' : 'Ativar meu acesso', link },
    validade: `O link vale por ${descreverValidade(convite.validityMs)} e pode ser usado uma única vez. Se ele expirar, peça um novo à administração.`,
    aviso: 'Não reconhece este convite? Ignore este e-mail. Sem este link, nenhum acesso é liberado.',
  });
}

export interface RedefinicaoParaEmail {
  name: string;
  email: string;
  /** Validade do link emitido (`expires_at` menos o instante da emissão). */
  validityMs: number;
}

/** Redefinição pedida pela ADMINISTRAÇÃO (não há "esqueci minha senha"): o
 * texto nunca diz que a própria pessoa pediu. */
export function emailDeRedefinicao(pessoa: RedefinicaoParaEmail, link: string): EmailMessage {
  return mensagem({
    to: { email: pessoa.email, name: pessoa.name },
    assunto: `Crie uma nova senha no ${MARCA.nome}`,
    previa: 'A administração enviou um link para você criar uma nova senha.',
    titulo: 'Criar uma nova senha',
    corpo: (meio) => [
      `A administração do ${MARCA.nome} enviou este link para você criar uma nova senha de acesso. Para isso, use o ${meio} abaixo.`,
      'Quando a nova senha for criada, as sessões abertas com a senha anterior serão encerradas.',
    ],
    acao: { rotulo: 'Criar nova senha', link },
    validade: `O link vale por ${descreverValidade(pessoa.validityMs)} e pode ser usado uma única vez. Se ele expirar, peça um novo à administração.`,
    aviso: `Não esperava esta mensagem? Ignore este e-mail: sua senha atual continua valendo. Se achar que há algo errado com a sua conta, fale com a administração do ${MARCA.nome}.`,
  });
}
