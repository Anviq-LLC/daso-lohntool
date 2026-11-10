// Local pipeline: typecheck, unit tests, build, browser tests. "--deploy" ships only after all of that passed.
import { execSync } from 'node:child_process';

const deploy = process.argv.includes('--deploy');
const steps = [
  ['Typecheck', 'pnpm exec tsc --noEmit'],
  ['Unit tests', 'pnpm test'],
  ['Build', 'pnpm build'],
  ['Browser tests', 'pnpm exec playwright test'],
];
if (deploy) steps.push(
  ['Apply migrations (production)', 'pnpm exec wrangler d1 migrations apply DB --remote'],
  ['Deploy', 'pnpm exec wrangler deploy'],
);
for (const [name, cmd] of steps) {
  console.log(`\n== ${name}`);
  try { execSync(cmd, { stdio: 'inherit' }); } catch { console.error(`\nFailed at: ${name}`); process.exit(1); }
}
console.log('\nAll steps passed.');
