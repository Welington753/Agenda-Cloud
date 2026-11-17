// "Contas e acessos" do portal, de ponta a ponta contra o backend real e o
// PostgreSQL DESCARTÁVEL, só com dados fictícios. A promoção a MASTER_OWNER e
// as contas de funcionário, sem vínculo e com convite pendente são fixture
// (SQL direto); nada sai da máquina.
//
// - A aba de estabelecimentos mostra só responsáveis (dono, dono de dois
//   estabelecimentos numa linha, convite de dono pendente); funcionário,
//   conta sem vínculo e administrador ficam fora da lista, da busca e dos
//   totais. A de administradores mostra só a conta da plataforma.
// - Quem não é proprietário recebe 403 nas duas abas e na ficha por id.
// - Computador e celular, sem rolagem horizontal; nada é alterado no banco.
//
// Roda na invocação de `npm run test:browser:contas` (3 aceites de convite).
import { expect, request as novoContextoDeApi, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import { semRolagemHorizontal } from "./support/portal";

const SENHA = "senha-de-teste-contas-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 12);

test("Contas e acessos separa responsáveis e administradores no servidor e na tela", async ({ page }) => {
  const marca = `cea-${id()}`;
  const email = (nome: string) => `${marca}-${nome}@example.test`;
  const outraSessao = await novoContextoDeApi.newContext();
  const db = await conectarBancoDeTeste();
  try {
    // Proprietária da plataforma (sessão da página), sem estabelecimento.
    const admin = await criarContaDeTeste(page.request, {
      ownerName: `Admin ${marca}`,
      businessName: `${marca} Descartável`,
      email: email("admin"),
      password: SENHA,
    });
    await db.query("DELETE FROM memberships WHERE user_id = $1", [admin.user.id]);
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [admin.user.id]);

    // Dono comum (outra sessão): sem acesso às duas abas nem à ficha por id.
    const dono = await criarContaDeTeste(outraSessao, {
      ownerName: `Dono ${marca}`,
      businessName: `${marca} Barbearia`,
      email: email("dono"),
      password: SENHA,
    });
    for (const caminho of ["/platform/users", "/platform/users?scope=ADMINS", `/platform/users/${admin.user.id}`]) {
      expect((await outraSessao.get(`${API_DE_TESTE}${caminho}`)).status(), caminho).toBe(403);
    }

    // Dona de dois estabelecimentos.
    const donaDupla = await criarContaDeTeste(outraSessao, {
      ownerName: `Dona Dupla ${marca}`,
      businessName: `${marca} Clínica`,
      email: email("dona-dupla"),
      password: SENHA,
    });
    await db.query("INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')", [
      id(),
      donaDupla.user.id,
      dono.tenant.id,
    ]);
    // Funcionário, conta sem vínculo e responsável com convite pendente.
    const novaConta = async (nome: string, status = "ACTIVE") => {
      const userId = id();
      await db.query("INSERT INTO users (id, name, email, status) VALUES ($1, $2, $3, $4::user_status)", [
        userId,
        `${nome} ${marca}`,
        email(nome.toLowerCase().replaceAll(" ", "-")),
        status,
      ]);
      return userId;
    };
    const funcionario = await novaConta("Funcionario");
    await db.query("INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'RECEPCIONISTA')", [
      id(),
      funcionario,
      dono.tenant.id,
    ]);
    await novaConta("Sem Vinculo");
    const pendente = await novaConta("Pendente", "INVITED");
    await db.query(
      `INSERT INTO invites (id, type, target_name, target_email, tenant_id, establishment_role, status, token_hash,
                            created_by_user_id, expires_at, target_user_id)
       VALUES ($1, 'ESTABLISHMENT', $2, $3, $4, 'DONO', 'PENDING', $5, $6, now() + interval '1 day', $7)`,
      [id(), `Pendente ${marca}`, email("pendente"), dono.tenant.id, randomUUID().replaceAll("-", "").repeat(2), admin.user.id, pendente],
    );

    const fotografia = async () =>
      (
        await db.query(
          `SELECT (SELECT count(*) FROM users WHERE email::text LIKE $1)::int AS contas,
                  (SELECT count(*) FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email::text LIKE $1)::int AS vinculos,
                  (SELECT string_agg(COALESCE(platform_role::text, '-') || status::text, ',' ORDER BY id) FROM users
                    WHERE email::text LIKE $1) AS papeis`,
          [`${marca}%`],
        )
      ).rows[0];
    const antes = await fotografia();

    // ------------------------------------------------ computador (1280 px)
    await page.goto("/portal/usuarios");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Contas e acessos", level: 1 })).toBeVisible();
    const abas = main.getByRole("navigation", { name: "Tipo de conta" });
    await expect(abas.getByRole("link")).toHaveText(["Contas dos estabelecimentos", "Administradores do sistema"]);
    await expect(abas.getByRole("link", { name: "Contas dos estabelecimentos" })).toHaveAttribute("aria-current", "page");

    const buscar = async (texto: string, rotulo = "Estabelecimento, responsável ou e-mail") => {
      await main.getByLabel(rotulo).fill(texto);
      await main.getByRole("button", { name: "Pesquisar" }).click();
    };
    await buscar(marca);
    await expect(main.getByRole("status")).toHaveText("3 contas de estabelecimentos");
    await expect(main.getByTestId("total-contas")).toContainText("3");
    const lista = main.getByTestId("lista-contas");
    await expect(lista.locator("tbody tr")).toHaveCount(3);
    for (const fora of ["Funcionario", "Sem Vinculo", "Admin"]) await expect(lista).not.toContainText(`${fora} ${marca}`);
    // Dona de dois estabelecimentos: uma linha só, com os dois.
    const linhaDupla = lista.locator("tbody tr", { hasText: `Dona Dupla ${marca}` });
    await expect(linhaDupla).toContainText(`${marca} Barbearia`);
    await expect(linhaDupla).toContainText(`${marca} Clínica`);
    const linhaPendente = lista.locator("tbody tr", { hasText: `Pendente ${marca}` });
    await expect(linhaPendente).toContainText("Convite pendente");
    await expect(linhaPendente.getByRole("link", { name: `Ver convite: Pendente ${marca}` })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("contas-estabelecimentos-1280.png"), fullPage: true });

    // Busca pelo estabelecimento e filtro de situação, no servidor.
    await buscar(`${marca} Clínica`);
    await expect(main.getByRole("status")).toHaveText("1 conta de estabelecimento");
    await buscar(email("funcionario"));
    await expect(main.getByRole("status")).toHaveText("0 contas de estabelecimentos");
    await expect(main.getByTestId("total-contas")).toContainText("0");
    await main.getByLabel("Situação").selectOption("INVITED");
    await buscar(marca);
    await expect(main.getByRole("status")).toHaveText("1 conta de estabelecimento");
    await expect(main.getByTestId("total-contas")).toContainText("3");

    // Aba de administradores.
    await abas.getByRole("link", { name: "Administradores do sistema" }).click();
    await expect(page).toHaveURL("/portal/usuarios?aba=administradores");
    await expect(main.getByText("Acesso exclusivo aos proprietários da plataforma.")).toBeVisible();
    await buscar(marca, "Nome ou e-mail");
    await expect(main.getByRole("status")).toHaveText("1 administrador");
    const admins = main.getByTestId("lista-administradores");
    await expect(admins.locator("tbody tr")).toHaveCount(1);
    await expect(admins).toContainText(`Admin ${marca}`);
    await expect(admins).toContainText("Proprietário da plataforma");
    await page.screenshot({ path: test.info().outputPath("contas-administradores-1280.png"), fullPage: true });

    // Ficha pela ação da linha.
    await abas.getByRole("link", { name: "Contas dos estabelecimentos" }).click();
    await buscar(email("dono"));
    await main.getByRole("link", { name: `Ver conta: Dono ${marca}` }).click();
    await expect(page.getByRole("heading", { name: `Dono ${marca}`, level: 1 })).toBeVisible();

    // O funcionário continua na equipe do estabelecimento.
    const equipe = await page.request.get(`${API_DE_TESTE}/platform/establishments/${dono.tenant.id}/members`);
    expect(equipe.status()).toBe(200);
    const membros = ((await equipe.json()) as { members: { user: { id: string } }[] }).members.map((m) => m.user.id);
    expect(membros).toContain(funcionario);

    // ------------------------------------------------ celular (390 e 360 px)
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/portal/usuarios");
      await buscar(marca);
      await expect(main.getByRole("status")).toHaveText("3 contas de estabelecimentos");
      await expect(main.locator("thead")).toBeHidden();
      await expect(lista.locator("tbody tr", { hasText: `Dona Dupla ${marca}` })).toBeVisible();
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`contas-estabelecimentos-${width}.png`), fullPage: true });
      await page.goto("/portal/usuarios?aba=administradores");
      await buscar(marca, "Nome ou e-mail");
      await expect(main.getByRole("status")).toHaveText("1 administrador");
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`contas-administradores-${width}.png`), fullPage: true });
    }

    // Só leitura: nenhuma conta, vínculo, papel ou situação mudou.
    expect(await fotografia()).toEqual(antes);
  } finally {
    await outraSessao.dispose();
    await db.end();
  }
});
