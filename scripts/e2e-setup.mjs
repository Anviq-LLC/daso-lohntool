// Builds throwaway local databases from synthetic fixtures and a test signing key. Never touches remote data.
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';

const state = '.e2e-state';
rmSync(state, { recursive: true, force: true });
mkdirSync(state, { recursive: true });
const w = (...args) => execFileSync('pnpm', ['exec', 'wrangler', ...args, '--local', '--persist-to', state], { stdio: 'inherit', shell: true });
w('d1', 'migrations', 'apply', 'DB');
for (const [db, files] of [['PLAN', ['plan-schema', 'plan-seed']], ['AUFMASS', ['aufmass-schema', 'aufmass-seed']], ['DB', ['lohn-seed']]])
  for (const f of files) w('d1', 'execute', db, '--file', `e2e/fixtures/${f}.sql`);

// Test-only Access emulation: the worker verifies real RS256 tokens against this key.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
writeFileSync(`${state}/private.pem`, privateKey.export({ type: 'pkcs8', format: 'pem' }));
writeFileSync('.dev.vars', [
  'CF_ACCESS_TEAM_DOMAIN=test.access.example',
  'CF_ACCESS_AUD=test-aud',
  `CF_ACCESS_JWKS='${JSON.stringify({ keys: [jwk] })}'`,
  'DASO_OWNER_EMAIL=owner@example.test',
].join('\n') + '\n');
