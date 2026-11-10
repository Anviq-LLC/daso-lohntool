# daso-lohntool

Internal payroll preparation for DaSO Lüftungsbau. It reads hours, travel, meals and absences from the Montageplanung and revenue per employee from the Aufmaßtool (both bound read-only), calculates wages and bonuses per month, and exports released months.

## Run

    pnpm install
    pnpm sync:aufmass   # refresh the vendored revenue logic from ../daso-aufmasstool
    pnpm test           # calculation and import tests
    pnpm run ci          # typecheck, tests, build, browser tests

Browser tests start a local worker with synthetic databases and signed test tokens (`scripts/e2e-setup.mjs`). Nothing touches production.

## Deploy

1. `wrangler d1 create daso-lohntool`, put the id into `wrangler.jsonc`.
2. Put the application in front of Cloudflare Access and set `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `DASO_OWNER_EMAIL` as worker variables. Without them every request returns 401.
3. `pnpm run ci --deploy` applies migrations and deploys after all checks pass.
4. Add the accounting and management emails under Einstellungen, Zugänge.
