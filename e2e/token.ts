import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function token(over: { email?: string; aud?: string; exp?: number; iss?: string } = {}) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b({ alg: 'RS256', kid: 'k1' });
  const body = b({
    email: over.email ?? 'owner@example.test', aud: [over.aud ?? 'test-aud'], iss: over.iss ?? 'https://test.access.example',
    exp: over.exp ?? Math.floor(Date.now() / 1000) + 3600,
  });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(readFileSync('.e2e-state/private.pem')).toString('base64url');
  return `${head}.${body}.${sig}`;
}
export const header = (over = {}) => ({ 'cf-access-jwt-assertion': token(over) });
