# Ensaio do alcance real das permissões numa cópia restaurada

This rehearsal belongs to stage 1 of `docs/plans/permissoes-individuais.md` (section 5.4). On a disposable copy of the pilot, it compares the responses of the pilot code with those of the current code, for every membership: which requests are refused, the IDs returned, the totals, and the fields that are hidden.

It is the real-data counterpart of two automated tests:

- `backend/test/access-fingerprint/access-fingerprint.spec.ts`: the pure comparison against the frozen copy of the pilot policies;
- `backend/test/alcance-real-postgres.db-e2e-spec.ts`: real responses with fictitious data, checked against the same frozen copy.

## Ground rules

- **Never the pilot.** The rehearsal runs only on a local disposable PostgreSQL with TLS, restored from a backup that already exists on this computer. It never connects to the pilot, never fetches production credentials and does not take a new backup.
- **The original backup is never touched.** The script only reads the dump, after checking its SHA-256 against `piloto.dump.sha256`.
- **Matching PostgreSQL version.** The pilot runs PostgreSQL 17. The restore uses PostgreSQL 17.12 (`%USERPROFILE%\AgendaCloud-ferramentas\pg17x`), as in the sales rehearsal.
- **No external integrations.** The collector calls the services directly, with no HTTP server, so no e-mail and no push notifications are sent. The run sets `IGNORE_DOTENV_FILE=true`.
- **No writes.** The collector only calls read methods. The runner records the md5 of every table before and after the run and fails if any table changed.
- **Outputs stay out of the repository.** Outputs go to `%USERPROFILE%\AgendaCloud-operacoes\ensaio-alcance-permissoes-<data>`. They contain IDs, amounts in cents, counts, hidden-field markers and a SHA-256 of each response. They contain no names, phone numbers, e-mail addresses or free text. Even so, they are never committed.

## Steps

1. **Restore.**
   - Create a PostgreSQL 17 cluster with TLS on a free port, with a random password and a self-signed certificate (SAN `localhost` and `127.0.0.1`).
   - Check the dump's SHA-256.
   - Run `pg_restore --no-owner --no-acl --single-transaction --exit-on-error` into a new database.
   - The procedure is the same as in `ensaio-vendas-2026-11-26/ops/backup-e-restauracao.mjs`, step 4.
2. **Migrations up to the pilot's state.**
   - In `backend/` of the current worktree, run `npm run build:migrations-runtime && npm run migration:run:compiled` with `DIRECT_URL` pointing to the copy.
   - Between `8f71335` and the stage 1 refactor there is no new migration, so the copy ends with the 28 migrations of the pilot.
3. **Pilot code ("before").**
   - Create a detached worktree at `8f71335`.
   - Copy `backend/test/alcance-real/coletar-alcance.ts` and `coletar-copia.db-e2e-spec.ts` into it. The collector imports only what exists unchanged in both versions.
   - Point `node_modules` to a worktree with the same lockfiles.
4. **Collect.** In each worktree (before, then after), run the following with `DB_E2E_DIRECT_URL`, `NODE_EXTRA_CA_CERTS` and `ALCANCE_SAIDA=<output file>`:

   ```
   npx vitest run --config ./vitest.config.db-e2e.ts test/alcance-real/coletar-copia.db-e2e-spec.ts
   ```

   - The instant and the period are fixed: `ALCANCE_AGORA`, `ALCANCE_DE`, `ALCANCE_ATE` and `ALCANCE_DIA`, with defaults set in the runner.
   - Both sides must use the same values.
5. **Compare.** Run:

   ```
   node backend/test/alcance-real/comparar-alcance.mjs antes.json depois.json
   ```

   - It prints only counts and keys.
   - Exit code 0 means no differences and no table changed.
6. **Repeat the "after" run** and compare it with the first one. Any difference here is a technical field that varies between runs, and it must be listed before anything is set aside. So far no field has varied, so nothing is normalized.
7. **Clean up.**
   - Stop the cluster.
   - Remove the "before" worktree, removing only the `node_modules` links with `cmd /c rmdir`.
   - Keep the outputs and the original backup.

## What the collector compares, per membership

- **Session:** areas (`sessionAreas`), with the real features and sales of the establishment.
- **Agenda and availability:**
  - the agenda for the period: IDs, `hidden`, prices, and whether contact and notes are present;
  - the own agenda: linked professional, permissions and IDs;
  - the availability query: prices, total and `priceHidden`.
- **Commissions:** own commissions, and the general report.
- **Payments and dashboard:** the payments list and the dashboard summary.
- **Consumers:** consumers (IDs and total), and the history of the first three consumers (prices and payment presence).
- **Catalog and stock:** services, professionals and stock products.
- **Sales:** sales and sale payments, for both the own scope and the general scope.
- **Team:** the team overview (memberships, effective grants, grantable permissions and seats).

A refusal is recorded with its status and `code`. A response is recorded as a summary plus the SHA-256 of the whole response, so equality is proven without storing the content.

## Result on 27/11/2026

- **Backup:** `pre-mig27-26-backup-2026-11-26T15-37-35Z`. Its SHA-256 matched. It was restored into PostgreSQL 17.12 with TLS, and migrations 27 and 28 were applied to the copy, 28 in total.
- **Codes compared:** `8f71335` (the pilot) against `57d692e` (the integration after #161).
- **Coverage:**
  - 4 memberships: 3 owners and 1 staff professional, all active;
  - 18 kinds of request per membership, all of them answered or refused somewhere.
- **Result:**
  - zero differences, zero tables changed by either run;
  - the repeated "after" run was identical;
  - a deliberate mutation (owner without team management) produced 6 differences and was then reverted.
- **Limits of this copy:**
  - It predates the sales publication. There are no managers, no receptionists and no recorded sales.
  - Data written after 26/11 15:37 UTC is not in it.

  For those roles and for sales, the proof is the test with fictitious data (`alcance-real-postgres`). Repeating the rehearsal with current data needs a new backup, which was not authorized in this round. It belongs with the stage 2 rehearsal, which needs a backup anyway.
