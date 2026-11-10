// Identity comes only from a Cloudflare Access JWT that is verified here. Without it every request is refused.
export type Role = 'buchhaltung' | 'gf';
export type Env = {
  DB: D1Database; PLAN: D1Database; AUFMASS: D1Database; ASSETS: Fetcher;
  CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; CF_ACCESS_JWKS?: string;
  DASO_OWNER_EMAIL?: string; DASO_DEV_IDENTITY?: string;
};
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Identity = { email: string; role: Role };

type Jwk = JsonWebKey & { kid: string };
const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64(s)));
let cached: { url: string; keys: Jwk[]; at: number } | undefined;

async function keys(env: Env): Promise<Jwk[]> {
  if (env.CF_ACCESS_JWKS) return (JSON.parse(env.CF_ACCESS_JWKS) as { keys: Jwk[] }).keys;
  const url = `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  if (cached?.url === url && Date.now() - cached.at < 3_600_000) return cached.keys;
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(503, 'Anmeldung nicht prüfbar.');
  const k = ((await res.json()) as { keys: Jwk[] }).keys;
  cached = { url, keys: k, at: Date.now() };
  return k;
}

async function accessEmail(request: Request, env: Env): Promise<string> {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return '';
  const [h, p, sig] = token.split('.');
  if (!sig) return '';
  try {
    const head = json(h), body = json(p);
    const jwk = (await keys(env)).find((k) => k.kid === head.kid);
    if (head.alg !== 'RS256' || !jwk) return '';
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(sig), new TextEncoder().encode(h + '.' + p)))) return '';
    const aud = ([] as string[]).concat(body.aud);
    if (!aud.includes(env.CF_ACCESS_AUD) || body.iss !== 'https://' + env.CF_ACCESS_TEAM_DOMAIN) return '';
    if (!(body.exp * 1000 > Date.now()) || typeof body.email !== 'string') return '';
    return body.email.trim().toLowerCase();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return '';
  }
}

export async function identify(request: Request, env: Env): Promise<Identity> {
  const email = await accessEmail(request, env);
  if (!email) {
    // Local development only: never set DASO_DEV_IDENTITY in production.
    if (env.DASO_DEV_IDENTITY === '1' && !env.CF_ACCESS_AUD) return { email: 'dev@localhost', role: 'gf' };
    throw new HttpError(401, 'Bitte anmelden.');
  }
  if (env.DASO_OWNER_EMAIL?.trim().toLowerCase() === email) return { email, role: 'gf' };
  const row = await env.DB.prepare('SELECT role FROM roles WHERE email = ?').bind(email).first<{ role: Role }>();
  if (!row) throw new HttpError(403, 'Kein Zugang zum Lohntool.');
  return { email, role: row.role };
}

// The two source databases are bound for reading. This wrapper makes writing through them impossible.
export function readOnly(db: D1Database): D1Database {
  const deny = () => { throw new HttpError(500, 'Quelldatenbank ist schreibgeschützt.'); };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql: string) => {
          if (!/^\s*select\s/i.test(sql) || sql.trim().replace(/;\s*$/, '').includes(';')) deny();
          return target.prepare(sql);
        };
      }
      if (prop === 'batch' || prop === 'exec' || prop === 'dump' || prop === 'withSession') return deny;
      const v = (target as never)[prop];
      return typeof v === 'function' ? (v as () => unknown).bind(target) : v;
    },
  });
}
