// Entrada oculta do provisionamento MASTER_OWNER, sem banco nem rede. As URLs
// são fictícias. O stdin é simulado; o comportamento num console real do
// Windows está registrado em docs/runbooks/continuidade-promocao-master-owner.md.
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  MOTIVOS,
  Parada,
  classificarEntrada,
  conferirConfirmacao,
  lerConfirmacao,
  lerOculto,
} from './promover-master-owner-entrada.mjs';

const SENHA = 'npg_Ab1-x.Y_z~Q9%21';
const URL_OK = `postgresql://neondb_owner:${SENHA}@ep-ficticio-000000.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`;

class StdinFalso extends EventEmitter {
  isTTY = true;
  raw: boolean[] = [];
  pausado = true;
  setRawMode(v: boolean) {
    this.raw.push(v);
    return this;
  }
  resume() {
    this.pausado = false;
    return this;
  }
  pause() {
    this.pausado = true;
    return this;
  }
  setEncoding() {
    return this;
  }
}

function ler(
  blocos: string[],
  opcoes: { isTTY?: boolean; leitor?: typeof lerOculto } = {},
) {
  const stdin = new StdinFalso();
  if (opcoes.isTTY === false) stdin.isTTY = false;
  const escrito: string[] = [];
  const promessa = (opcoes.leitor ?? lerOculto)('URL: ', {
    stdin,
    stdout: { write: (t: string) => escrito.push(t) },
    esperaAposEnterMs: 20,
  });
  setTimeout(() => {
    for (const b of blocos) stdin.emit('data', b);
  }, 0);
  return { promessa, stdin, escrito };
}

describe('classificarEntrada', () => {
  it('aceita uma URL e não a altera', () => {
    expect(classificarEntrada(URL_OK)).toBeNull();
    expect(classificarEntrada(`  ${URL_OK}  `)).toBeNull();
  });

  it.each([
    ['', 'ERR_URL_VAZIA'],
    ['   ', 'ERR_URL_VAZIA'],
    ['\u0016', 'ERR_URL_CTRL_V_SEM_COLAGEM'],
    [`\u0016${URL_OK}`, 'ERR_URL_CTRL_V_SEM_COLAGEM'],
    [`\u001b[200~${URL_OK}\u001b[201~`, 'ERR_URL_CARACTERE_DE_CONTROLE'],
    [`${URL_OK.slice(0, 30)}\t${URL_OK.slice(30)}`, 'ERR_URL_CARACTERE_DE_CONTROLE'],
    [`${URL_OK}${URL_OK}`, 'ERR_URL_MAIS_DE_UMA'],
    [`${URL_OK} ${URL_OK}`, 'ERR_URL_MAIS_DE_UMA'],
    [`psql '${URL_OK}'`, 'ERR_URL_COM_TEXTO_EXTRA'],
    [`"${URL_OK}"`, 'ERR_URL_COM_TEXTO_EXTRA'],
    [`'${URL_OK}'`, 'ERR_URL_COM_TEXTO_EXTRA'],
    [`DATABASE_URL=${URL_OK}`, 'ERR_URL_COM_TEXTO_EXTRA'],
    ['postgresql://[invalido/neondb', 'ERR_URL_INVALIDA'],
  ])('classifica %j como %s', (entrada, codigo) => {
    expect(classificarEntrada(entrada)).toBe(codigo);
    expect(MOTIVOS[codigo as string]).toBeTruthy();
  });

  it('os motivos nunca contêm a entrada', () => {
    for (const motivo of Object.values(MOTIVOS)) {
      expect(motivo).not.toContain('npg_');
      expect(motivo).not.toContain('neon.tech');
    }
  });
});

describe('lerOculto', () => {
  it('colagem única e Enter: devolve exatamente o que chegou, sem eco', async () => {
    const { promessa, stdin, escrito } = ler([`${URL_OK}\r`]);
    const valor = await promessa;
    expect(valor).toBe(URL_OK);
    expect(new URL(valor).password).toBe(SENHA);
    expect(escrito.join('')).not.toContain('npg_');
    expect(stdin.raw).toEqual([true, false]);
    expect(stdin.pausado).toBe(true);
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('colagem recebida em blocos', async () => {
    const { promessa } = ler([URL_OK.slice(0, 40), URL_OK.slice(40, 41), URL_OK.slice(41), '\r']);
    expect(await promessa).toBe(URL_OK);
  });

  it('CR LF do Enter conta como um Enter só', async () => {
    const { promessa } = ler([`${URL_OK}\r\n`]);
    expect(await promessa).toBe(URL_OK);
  });

  it('entrada vazia devolve vazio (classificado depois)', async () => {
    const { promessa } = ler(['\r']);
    expect(await promessa).toBe('');
  });

  it('texto depois do Enter é recusado, nunca vai para a confirmação', async () => {
    const { promessa, stdin } = ler([`${URL_OK}\r\n${URL_OK}\r\n`]);
    await expect(promessa).rejects.toMatchObject({ message: 'ERR_URL_MAIS_DE_UMA_LINHA' });
    expect(stdin.listenerCount('data')).toBe(0);
    expect(stdin.pausado).toBe(true);
  });

  it('Ctrl+C cancela', async () => {
    const { promessa } = ler(['postgres', '\u0003']);
    const erro = await promessa.catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Parada);
    expect((erro as Error).message).toBe('CANCELADO');
  });

  it('Backspace apaga o último caractere', async () => {
    const { promessa } = ler([`${URL_OK}x\u0008\r`]);
    expect(await promessa).toBe(URL_OK);
  });

  it('sem terminal interativo, para antes de pedir a URL', async () => {
    const { promessa, escrito } = ler([], { isTTY: false });
    await expect(promessa).rejects.toMatchObject({ message: 'ERR_TERMINAL_NAO_INTERATIVO' });
    expect(escrito).toEqual([]);
  });
});

describe('lerConfirmacao', () => {
  const FRASE = 'PROMOVER wwluiz90@gmail.com';
  const confirmar = (blocos: string[]) => ler(blocos, { leitor: lerConfirmacao });

  it('lê em modo raw, com eco, e devolve a frase exata', async () => {
    const { promessa, stdin, escrito } = confirmar([...FRASE, '\r']);
    const valor = await promessa;
    expect(valor).toBe(FRASE);
    expect(conferirConfirmacao(valor, FRASE)).toBeNull();
    expect(escrito.join('')).toBe(`URL: ${FRASE}\n`);
    expect(stdin.raw).toEqual([true, false]);
    expect(stdin.pausado).toBe(true);
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('frase colada num bloco só, com CR LF', async () => {
    const { promessa } = confirmar([`${FRASE}\r\n`]);
    expect(conferirConfirmacao(await promessa, FRASE)).toBeNull();
  });

  it('Backspace apaga também na tela', async () => {
    const { promessa, escrito } = confirmar([`${FRASE}x`, '\u007f', '\r']);
    expect(await promessa).toBe(FRASE);
    expect(escrito.join('')).toContain('\b \b');
  });

  it('controles entram no valor sem eco', async () => {
    const { promessa, escrito } = confirmar(['\u0016', '\r']);
    expect(conferirConfirmacao(await promessa, FRASE)).toBe('ERR_CONFIRMACAO_CTRL_V_SEM_COLAGEM');
    expect(escrito.join('')).not.toContain('\u0016');
  });

  it('texto depois do Enter é recusado', async () => {
    const { promessa } = confirmar([`${FRASE}\r${FRASE}\r`]);
    await expect(promessa).rejects.toMatchObject({ message: 'ERR_CONFIRMACAO_MAIS_DE_UMA_LINHA' });
  });

  it.each([
    ['', 'ERR_CONFIRMACAO_VAZIA'],
    ['   ', 'ERR_CONFIRMACAO_VAZIA'],
    ['promover wwluiz90@gmail.com', 'ERR_CONFIRMACAO_DIFERENTE'],
    [`${FRASE} `, 'ERR_CONFIRMACAO_DIFERENTE'],
    ['PROMOVER outra@example.com', 'ERR_CONFIRMACAO_DIFERENTE'],
    [`${FRASE}\u001b`, 'ERR_CONFIRMACAO_CARACTERE_DE_CONTROLE'],
  ])('confirmação %j aborta com %s', (resposta, codigo) => {
    expect(conferirConfirmacao(resposta, FRASE)).toBe(codigo);
    expect(MOTIVOS[codigo]).toBeTruthy();
    expect(MOTIVOS[codigo]).not.toContain(resposta.trim() || '\u0000');
  });
});
