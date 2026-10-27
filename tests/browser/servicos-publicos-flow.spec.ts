// Serviços no agendamento público e a etapa "Profissional" — navegador
// real, backend real e PostgreSQL descartável.
//
// REPRODUZ o caso relatado: com a página pública já ativa, o dono cadastra
// serviços novos pela tela de Serviços e eles não aparecem para o cliente.
// A causa é a regra de elegibilidade do servidor (serviço ativo, ligado no
// online e realizado por pelo menos um profissional ativo e ligado no
// online): o cadastro de serviço não cria vínculo com profissional. O teste
// prova que:
// - o serviço só aparece depois do vínculo, sem cache nem dado antigo;
// - a tela de Serviços diz ao dono o que falta, sem ativar nem vincular nada;
// - serviço inativo, desligado do online ou só com profissional inativo
//   continua fora;
// - a etapa "Profissional" é sempre mostrada: vários para escolher, um
//   pré-selecionado e explícito, nenhum com mensagem e sem continuar;
// - trocar o serviço descarta profissional e horário incompatíveis.
//
// Orçamento: 1 cadastro e 1 login; nenhum pedido público.
// Invocação própria (`npm run test:browser:servicos-publicos`).
import { criarContaDeTeste as contaPorConvite } from "./support/contas-de-teste";
import { expect, test, type Page } from "@playwright/test";
import { DATA, WEEKDAY_DA_DATA } from "./data-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-dos-servicos-publicos-123";
const rotuloDoDia = `dom ${DATA.slice(8, 10)}/${DATA.slice(5, 7)}`;

async function api<T>(pagina: Page, caminho: string, method = "GET", body?: unknown) {
  return pagina.evaluate(
    async ({ url, method, body }) => {
      const r = await fetch(url, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const texto = await r.text();
      return { status: r.status, corpo: (texto ? JSON.parse(texto) : null) as T };
    },
    { url: `${BACKEND_URL}${caminho}`, method, body },
  );
}

const servicoBase = {
  shortDescription: "",
  priceCents: 4000,
  priceVisible: true,
  durationMinutes: 30,
  bufferAfterMinutes: 0,
  modality: "IN_PERSON",
  requiresManualConfirmation: false,
};

/** Nomes dos serviços que o cliente vê, na ordem da página. */
async function servicosPublicos(p: Page) {
  const lista = p.getByTestId("lista-servicos-publicos");
  await expect(lista).toBeVisible();
  return lista.getByRole("button").evaluateAll((botoes) => botoes.map((b) => b.querySelector("span")?.textContent ?? ""));
}

const cartaoDoServico = (page: Page, nome: string) => page.getByTestId("lista-servicos").getByRole("article", { name: nome });

test("serviço novo só vai ao público com profissional elegível; o dono vê o que falta; etapa Profissional explícita", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `servicos-publicos-${sufixo}@example.test`;
  await contaPorConvite(request, { ownerName: "Dono Estiloso", businessName: `Barzinho Estiloso ${sufixo}`, email, phone: "11977770005", password: SENHA });
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/conta\/visao-geral$/);
  const me = await api<{ activeContext: { tenantId: string } }>(page, "/auth/me");
  const base = `/tenants/${me.corpo.activeContext.tenantId}`;

  // ------------------------------------------- estado inicial: Corte e Barba com o Rafa
  const criar = async (name: string, extra: Record<string, unknown> = {}) => {
    const r = await api<{ service: { id: string } }>(page, `${base}/services`, "POST", { ...servicoBase, name, activeInPublicBooking: true, ...extra });
    expect(r.status).toBe(201);
    return r.corpo.service.id;
  };
  const corte = await criar("Corte");
  const barba = await criar("Barba");
  const rafa = await api<{ professional: { id: string } }>(page, `${base}/professionals`, "POST", {
    name: "Rafa Barbeiro",
    serviceIds: [corte, barba],
  });
  expect(rafa.status).toBe(201);
  const rafaId = rafa.corpo.professional.id;
  expect(
    (await api(page, `${base}/professionals/${rafaId}/schedule`, "PUT", {
      days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "09:00", end: "12:00" }] }],
    })).status,
  ).toBe(200);
  const { corpo: online } = await api<{ settings: { slug: string } }>(page, `${base}/public-booking`, "PUT", { enabled: true });
  const link = `/agendar/${online.settings.slug}`;

  const cliente = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await cliente.newPage();
  await p.goto(link);
  expect(await servicosPublicos(p)).toEqual(["Barba", "Corte"]);

  // ------------------------------------------- dono cadastra dois serviços pela tela, depois da ativação
  await page.goto("/conta/configuracoes/servicos");
  for (const nome of ["Sobrancelha", "Lavagem"]) {
    await page.getByRole("button", { name: "Novo serviço" }).click();
    await page.getByLabel("Nome do serviço").fill(nome);
    await page.getByLabel("Duração (minutos)").fill("30");
    await page.getByLabel("Preço", { exact: true }).fill("25,00");
    await page.getByRole("button", { name: "Cadastrar serviço" }).click();
    await expect(cartaoDoServico(page, nome)).toBeVisible();
  }

  // Reprodução: ativos e ligados no online, mas sem profissional — fora do público.
  const servicosDoDono = await api<{ services: { name: string; active: boolean; activeInPublicBooking: boolean }[] }>(page, `${base}/services`);
  for (const nome of ["Sobrancelha", "Lavagem"]) {
    expect(servicosDoDono.corpo.services.find((s) => s.name === nome)).toMatchObject({ active: true, activeInPublicBooking: true });
  }
  const perfil = await p.evaluate(async (url) => (await (await fetch(url)).json()) as { profile: { services: { name: string }[] } }, `${BACKEND_URL}/public/${online.settings.slug}`);
  expect(perfil.profile.services.map((s) => s.name)).toEqual(["Barba", "Corte"]);
  await p.reload();
  expect(await servicosPublicos(p)).toEqual(["Barba", "Corte"]);

  // ------------------------------------------- o dono vê o que falta, na tela de Serviços
  await page.reload();
  for (const nome of ["Sobrancelha", "Lavagem"]) {
    const aviso = cartaoDoServico(page, nome).getByTestId("servico-fora-do-online");
    await expect(aviso).toContainText("Não aparece no agendamento online");
    await expect(aviso).toContainText("nenhum profissional ativo realiza este serviço");
    await expect(aviso.getByRole("link", { name: /Profissionais/ })).toHaveAttribute("href", "/conta/configuracoes/profissionais");
  }
  await expect(cartaoDoServico(page, "Corte").getByTestId("servico-fora-do-online")).toHaveCount(0);
  // Capturas do aviso nos dois temas da área privada e em três larguras.
  for (const tema of ["claro", "escuro"] as const) {
    await page.evaluate((valor) => localStorage.setItem("agenda-cloud:aparencia", valor), tema);
    for (const largura of [360, 390, 1280]) {
      await page.setViewportSize({ width: largura, height: 900 });
      await page.reload();
      await expect(cartaoDoServico(page, "Sobrancelha").getByTestId("servico-fora-do-online")).toBeVisible();
      const l = await page.evaluate(() => ({ conteudo: document.documentElement.scrollWidth, janela: window.innerWidth }));
      expect(l.conteudo).toBeLessThanOrEqual(l.janela);
      await page.screenshot({ path: test.info().outputPath(`servicos-aviso-${tema}-${largura}.png`), fullPage: true });
    }
  }
  await page.evaluate(() => localStorage.removeItem("agenda-cloud:aparencia"));
  await page.setViewportSize({ width: 1280, height: 720 });
  // Mostrar o aviso não grava nada.
  const servicosDepois = await api<{ services: { name: string }[] }>(page, `${base}/services`);
  expect(servicosDepois.corpo.services).toHaveLength(4);

  // ------------------------------------------- vínculo pela tela de Profissionais: agora aparecem
  await page.goto("/conta/configuracoes/profissionais");
  await page.getByRole("button", { name: "Editar Rafa Barbeiro" }).click();
  await page.getByLabel("Sobrancelha").check();
  await page.getByLabel("Lavagem").check();
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("button", { name: "Salvar alterações" })).toHaveCount(0);
  await p.reload();
  expect(await servicosPublicos(p)).toEqual(["Barba", "Corte", "Lavagem", "Sobrancelha"]);
  await page.goto("/conta/configuracoes/servicos");
  await expect(page.getByTestId("servico-fora-do-online")).toHaveCount(0);

  // ------------------------------------------- continuam fora: desligado do online, inativo, só com profissional inativo
  await criar("Hidratação", { activeInPublicBooking: false });
  const luzes = await criar("Luzes");
  const pigmentacao = await criar("Pigmentação");
  // O Rafa passa a fazer também Hidratação e Luzes (mantendo os vínculos atuais).
  const atuais = await api<{ services: { id: string; name: string }[] }>(page, `${base}/services`);
  const idsDoRafa = atuais.corpo.services
    .filter((s) => ["Corte", "Barba", "Sobrancelha", "Lavagem", "Hidratação", "Luzes"].includes(s.name))
    .map((s) => s.id);
  expect((await api(page, `${base}/professionals/${rafaId}/services`, "PUT", { serviceIds: idsDoRafa })).status).toBeLessThan(300);
  expect((await api(page, `${base}/services/${luzes}/deactivate`, "POST")).status).toBeLessThan(300);
  const duda = await api<{ professional: { id: string } }>(page, `${base}/professionals`, "POST", {
    name: "Duda Estilista",
    serviceIds: [pigmentacao, corte],
  });
  expect(duda.status).toBe(201);
  const dudaId = duda.corpo.professional.id;
  expect(
    (await api(page, `${base}/professionals/${dudaId}/schedule`, "PUT", {
      days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "14:00", end: "16:00" }] }],
    })).status,
  ).toBe(200);
  await p.reload();
  // Pigmentação aparece enquanto a Duda está ativa...
  expect(await servicosPublicos(p)).toEqual(["Barba", "Corte", "Lavagem", "Pigmentação", "Sobrancelha"]);

  // ------------------------------------------- etapa Profissional: vários, um, trocar serviço
  await p.getByTestId("lista-servicos-publicos").getByRole("button", { name: /^Corte/ }).click();
  await expect(p.getByTestId("titulo-etapa")).toHaveText("Escolha o profissional");
  const profissionais = p.getByTestId("lista-profissionais-publicos").getByRole("button");
  await expect(profissionais).toHaveCount(2);
  await p.getByTestId("lista-profissionais-publicos").getByRole("button", { name: /Duda Estilista/ }).click();
  await expect(p.getByTestId("titulo-etapa")).toHaveText("Escolha o dia e o horário");
  await p.getByTestId("lista-dias").getByRole("button", { name: rotuloDoDia }).click();
  await p.getByTestId("lista-horarios-publicos").getByRole("button", { name: "14:00", exact: true }).click();
  await p.getByTestId("voltar-etapa").click();
  await p.getByTestId("voltar-etapa").click();
  await expect(p.getByTestId("titulo-etapa")).toHaveText("Escolha o serviço");

  // Barba só com o Rafa: a etapa aparece, com ele pré-selecionado e o nome claro.
  await p.getByTestId("lista-servicos-publicos").getByRole("button", { name: /^Barba/ }).click();
  await expect(p.getByTestId("titulo-etapa")).toHaveText("Escolha o profissional");
  await expect(p.getByTestId("progresso-agendamento")).toContainText("Etapa 2 de 5");
  await expect(profissionais).toHaveCount(1);
  await expect(p.getByTestId("lista-profissionais-publicos").getByRole("button", { name: /Rafa Barbeiro/ })).toHaveAttribute("aria-pressed", "true");
  await expect(p.getByTestId("profissional-unico")).toContainText("Rafa Barbeiro");
  await p.getByTestId("continuar-profissional").click();
  await expect(p.getByTestId("titulo-etapa")).toHaveText("Escolha o dia e o horário");
  // Duda não faz Barba: o horário das 14:00 dela não vem junto.
  await expect(p.getByTestId("horario-escolhido")).toHaveText("Escolha um horário");
  await expect(p.getByTestId("contexto-escolhas")).toContainText("Barba · com Rafa Barbeiro");
  await p.getByTestId("lista-dias").getByRole("button", { name: rotuloDoDia }).click();
  await expect(p.getByTestId("lista-horarios-publicos").getByRole("button", { name: "09:00", exact: true })).toBeVisible();
  await expect(p.getByTestId("lista-horarios-publicos").getByRole("button", { name: "14:00", exact: true })).toHaveCount(0);

  // Sem horário no dia é diferente de sem profissional.
  const outroDia = p.getByTestId("lista-dias").getByRole("button").first();
  if ((await outroDia.textContent())?.replace(/\s+/g, " ").trim() !== rotuloDoDia) {
    await outroDia.click();
    await expect(p.getByTestId("sem-horarios")).toBeVisible();
    await expect(p.getByTestId("sem-profissional")).toHaveCount(0);
  }

  // ...e sai quando a Duda é desativada (único profissional dela).
  expect((await api(page, `${base}/professionals/${dudaId}/deactivate`, "POST")).status).toBeLessThan(300);
  await p.reload();
  expect(await servicosPublicos(p)).toEqual(["Barba", "Corte", "Lavagem", "Sobrancelha"]);
  await page.goto("/conta/configuracoes/servicos");
  await expect(cartaoDoServico(page, "Pigmentação").getByTestId("servico-fora-do-online")).toContainText(
    "nenhum profissional ativo realiza este serviço",
  );
  await expect(cartaoDoServico(page, "Hidratação").getByTestId("servico-fora-do-online")).toContainText(
    "desligado no agendamento online",
  );
  await expect(cartaoDoServico(page, "Luzes").getByTestId("servico-fora-do-online")).toHaveCount(0);

  // ------------------------------------------- nenhum profissional elegível: mensagem e sem continuar
  // Resposta montada a partir da real, com o serviço sem nenhum profissional
  // (o servidor nunca manda isso hoje; a tela não pode travar nem inventar).
  await p.route(`**/public/${online.settings.slug}`, async (rota) => {
    const resposta = await rota.fetch();
    const corpo = (await resposta.json()) as { profile: { professionals: { serviceIds: string[] }[] } };
    for (const prof of corpo.profile.professionals) prof.serviceIds = prof.serviceIds.filter((id) => id !== barba);
    await rota.fulfill({ response: resposta, json: corpo });
  });
  await p.reload();
  await p.getByTestId("lista-servicos-publicos").getByRole("button", { name: /^Barba/ }).click();
  await expect(p.getByTestId("titulo-etapa")).toHaveText("Escolha o profissional");
  await expect(p.getByTestId("sem-profissional")).toContainText("Nenhum profissional disponível para este serviço");
  await expect(p.getByTestId("continuar-profissional")).toHaveCount(0);
  await expect(p.getByTestId("lista-dias")).toHaveCount(0);
  await cliente.close();
});
