// Textos dos e-mails de conta. O link leva o token no FRAGMENTO (`#t=`): o
// navegador não envia o fragmento ao servidor, então ele não aparece em log
// de acesso do site, nem no `Referer`. A página lê o fragmento e manda o
// token no corpo de um POST explícito.
//
// Nenhum e-mail leva senha. Quem recebe define a própria senha na página.
import type { EmailMessage } from '../email/email-sender.js';

const escapar = (texto: string) =>
  texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function linkDeConvite(frontendUrl: string, token: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/convite#t=${token}`;
}

export function linkDeRedefinicao(frontendUrl: string, token: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/redefinir-senha#t=${token}`;
}

function mensagem(
  to: { email: string; name: string },
  subject: string,
  paragrafos: string[],
  acao: { rotulo: string; link: string },
): EmailMessage {
  const text = [`Olá, ${to.name}.`, '', ...paragrafos, '', `${acao.rotulo}: ${acao.link}`, '',
    'O link vale por 24 horas e só pode ser usado uma vez. Se você não esperava esta mensagem, ignore-a.'].join('\n');
  const html = [
    `<p>Olá, ${escapar(to.name)}.</p>`,
    ...paragrafos.map((p) => `<p>${escapar(p)}</p>`),
    `<p><a href="${escapar(acao.link)}">${escapar(acao.rotulo)}</a></p>`,
    '<p>O link vale por 24 horas e só pode ser usado uma vez. Se você não esperava esta mensagem, ignore-a.</p>',
  ].join('\n');
  return { to, subject, text, html };
}

export interface ConviteParaEmail {
  targetName: string;
  targetEmail: string;
  /** Estabelecimento do vínculo, ou `null` num convite de plataforma. */
  tenantName: string | null;
  /** A conta já tem senha: o aceite pede a senha atual, não cria outra. */
  accountExists: boolean;
}

export function emailDeConvite(convite: ConviteParaEmail, link: string): EmailMessage {
  const destino = convite.tenantName
    ? `ao estabelecimento ${convite.tenantName} no Agenda Cloud`
    : 'à administração da plataforma Agenda Cloud';
  const passo = convite.accountExists
    ? 'Para aceitar, abra o link e confirme com a senha da sua conta.'
    : 'Para ativar sua conta, abra o link, confira seus dados e crie a sua senha.';
  return mensagem(
    { email: convite.targetEmail, name: convite.targetName },
    convite.tenantName ? `Convite para ${convite.tenantName}` : 'Convite para a administração do Agenda Cloud',
    [`Você recebeu acesso ${destino}.`, passo],
    { rotulo: convite.accountExists ? 'Aceitar o convite' : 'Ativar minha conta', link },
  );
}

export function emailDeRedefinicao(pessoa: { name: string; email: string }, link: string): EmailMessage {
  return mensagem(
    { email: pessoa.email, name: pessoa.name },
    'Redefinição de senha do Agenda Cloud',
    [
      'A administração do Agenda Cloud pediu a redefinição da senha da sua conta.',
      'Abra o link para criar uma senha nova. Depois disso, as sessões abertas com a senha antiga são encerradas.',
    ],
    { rotulo: 'Criar uma senha nova', link },
  );
}
