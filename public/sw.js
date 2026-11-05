// Service worker do Agenda Cloud — SÓ notificações Web Push.
//
// - NÃO há manipulador de `fetch` e nada usa Cache Storage: nenhuma página
//   privada, sessão ou resposta da API é guardada por aqui. Sem conexão, o
//   aplicativo se comporta como o site normal.
// - A notificação é discreta e fixa ("Nova solicitação de agendamento. Toque
//   para analisar."): nada do cliente aparece na tela bloqueada. O conteúdo
//   que chega cifrado traz só os ids do estabelecimento e da solicitação.
// - Tocar abre a aba Solicitações da Agenda (/conta/agendamentos/solicitacoes)
//   com esses ids. Notificações entregues antes da mudança guardam o endereço
//   antigo (/conta/solicitacoes), que o site encaminha para o novo. A PÁGINA confere a sessão,
//   o vínculo com o estabelecimento e a permissão antes de mostrar qualquer
//   dado; sem sessão, o login preserva o destino. Abrir nunca confirma nada.
// - Janelas do portal da plataforma (`/portal`, `/portal/**`) nunca são
//   reaproveitadas: o toque usa uma janela da operação ou abre uma nova.
// - Reenvio do mesmo aviso (depois de uma falha) usa a mesma etiqueta: o
//   aparelho substitui a notificação em vez de empilhar duas.
"use strict";

const TITULO = "Nova solicitação de agendamento";
const TEXTO = "Toque para analisar.";
const ID_VALIDO = /^[A-Za-z0-9_-]{1,30}$/;
const LISTA = "/conta/agendamentos/solicitacoes";
const LISTA_ANTIGA = "/conta/solicitacoes";

function destinoDaNotificacao(dados) {
  if (!dados || typeof dados !== "object") return LISTA;
  const estabelecimento = dados.estabelecimento;
  const solicitacao = dados.solicitacao;
  if (typeof estabelecimento !== "string" || !ID_VALIDO.test(estabelecimento)) return LISTA;
  if (typeof solicitacao !== "string" || !ID_VALIDO.test(solicitacao)) return LISTA;
  return `${LISTA}?estabelecimento=${encodeURIComponent(estabelecimento)}&solicitacao=${encodeURIComponent(solicitacao)}`;
}

// `/portal` e `/portal/**`, comparando o caminho exato ou com a barra (não
// pega `/portalx`). Ver src/lib/administracao/rotas.ts.
function ehJanelaDoPortal(caminho) {
  return caminho === "/portal" || caminho.startsWith("/portal/");
}

function lerConteudo(evento) {
  try {
    const dados = evento.data ? evento.data.json() : null;
    return dados && dados.v === 1 && dados.tipo === "nova-solicitacao" ? dados : null;
  } catch {
    return null;
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(self.clients.claim());
});

self.addEventListener("push", (evento) => {
  // Todo push mostra uma notificação (exigência `userVisibleOnly`); conteúdo
  // inválido vira o aviso genérico que abre a lista.
  const dados = lerConteudo(evento);
  evento.waitUntil(
    self.registration.showNotification(TITULO, {
      body: TEXTO,
      icon: "/icone-192.png",
      badge: "/icone-192.png",
      tag: dados ? `solicitacao-${dados.solicitacao}` : "solicitacao",
      data: { destino: destinoDaNotificacao(dados) },
    }),
  );
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const salvo = evento.notification.data && evento.notification.data.destino;
  const destino =
    typeof salvo === "string" && (salvo.startsWith(`${LISTA}?`) || salvo === LISTA || salvo.startsWith(`${LISTA_ANTIGA}?`) || salvo === LISTA_ANTIGA)
      ? salvo
      : LISTA;
  const url = new URL(destino, self.location.origin).href;
  evento.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const janela of janelas) {
        const endereco = new URL(janela.url);
        if (endereco.origin !== self.location.origin) continue;
        // Janela do portal da plataforma (o aplicativo "Portal AC", com
        // manifest próprio): nunca é escolhida nem navegada para a operação.
        if (ehJanelaDoPortal(endereco.pathname)) continue;
        try {
          const navegada = "navigate" in janela ? await janela.navigate(url) : null;
          await (navegada || janela).focus();
          return;
        } catch {
          // Janela que não aceita navegação: abre outra.
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
