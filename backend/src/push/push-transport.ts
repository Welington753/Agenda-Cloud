// O POST para o serviço de push. Interface pequena para os testes trocarem
// por um serviço falso (nenhum teste fala com Google/Apple de verdade).
//
// - `https.request` não segue redirecionamento: um 3xx é só um status.
// - Tempo-limite fixo: serviço lento não prende o executor.
// - O corpo da resposta é descartado sem ler para log (pode ecoar dados).
import { request } from 'node:https';

export interface RequisicaoPush {
  url: URL;
  headers: Record<string, string>;
  body: Buffer;
}

export type RespostaPush = { tipo: 'http'; status: number } | { tipo: 'rede' };

export interface TransportePush {
  enviar(requisicao: RequisicaoPush): Promise<RespostaPush>;
}

const TEMPO_LIMITE_MS = 10_000;

export const transporteHttps: TransportePush = {
  enviar(requisicao) {
    return new Promise((resolve) => {
      let resolvido = false;
      const concluir = (resposta: RespostaPush) => {
        if (resolvido) return;
        resolvido = true;
        resolve(resposta);
      };
      const req = request(
        requisicao.url,
        {
          method: 'POST',
          headers: { ...requisicao.headers, 'Content-Length': String(requisicao.body.length) },
          timeout: TEMPO_LIMITE_MS,
        },
        (res) => {
          res.resume();
          res.on('end', () => concluir({ tipo: 'http', status: res.statusCode ?? 0 }));
          res.on('error', () => concluir({ tipo: 'rede' }));
        },
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => concluir({ tipo: 'rede' }));
      req.end(requisicao.body);
    });
  },
};
