import { HttpError, identify, readOnly, type Env, type Identity } from './auth.ts';
import { liveMonth, loadSettings, termsFor, DEFAULT_TERMS } from './month.ts';
import type { MonthResult } from '../calc/month.ts';
import { toCsv } from './export.ts';

const SECURITY = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};
const reply = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...SECURITY, ...extra } });

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const month = (s: string) => { if (!MONTH.test(s)) throw new HttpError(400, 'Ungültiger Monat.'); return s; };
const cents = (v: unknown) => { if (!Number.isSafeInteger(v)) throw new HttpError(400, 'Betrag muss in Cent angegeben werden.'); return v as number; };
const text = (v: unknown, max = 200) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, 'Ungültiger Text.'); return v.trim(); };
const STATES = ['offen', 'pruefung', 'freigabe', 'freigegeben', 'abgeschlossen'] as const;

async function log(env: Env, who: Identity, action: string, detail = '') {
  await env.DB.prepare('INSERT INTO audit (id, at, actor, action, detail) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), new Date().toISOString(), who.email, action, detail).run();
}

async function monthState(env: Env, m: string) {
  const row = await env.DB.prepare('SELECT status, snapshot, released_by, released_at FROM months WHERE month = ?').bind(m).first<{ status: string; snapshot: string | null; released_by: string | null; released_at: string | null }>();
  return row ?? { status: 'offen', snapshot: null, released_by: null, released_at: null };
}
const closed = (s: string) => s === 'freigegeben' || s === 'abgeschlossen';
async function assertOpen(env: Env, m: string) {
  if (closed((await monthState(env, m)).status)) throw new HttpError(409, 'Der Monat ist freigegeben und schreibgeschützt.');
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const who = await identify(request, env);
  const p = url.pathname, method = request.method;
  const body = async <T = Record<string, unknown>>() => {
    if (!(request.headers.get('content-type') || '').includes('application/json')) throw new HttpError(415, 'JSON erwartet.');
    return (await request.json()) as T;
  };
  // Browsers send Origin on cross-site writes; refuse anything not from this site.
  if (method !== 'GET') {
    const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
    if ((site && site !== 'same-origin') || (origin && origin !== url.origin)) throw new HttpError(403, 'Fremde Anfrage abgelehnt.');
  }

  if (p === '/api/me') return reply({ email: who.email, role: who.role });

  let m: RegExpMatchArray | null;
  if ((m = p.match(/^\/api\/months\/([\d-]+)$/)) && method === 'GET') {
    const mo = month(m[1]);
    const st = await monthState(env, mo);
    if (closed(st.status) && st.snapshot) return reply({ ...JSON.parse(st.snapshot), status: st.status, releasedBy: st.released_by, releasedAt: st.released_at, frozen: true });
    const live = await liveMonth(env, mo);
    return reply({ result: live.result, unchecked: live.unchecked, status: st.status, frozen: false });
  }
  if ((m = p.match(/^\/api\/months\/([\d-]+)\/status$/)) && method === 'POST') {
    const mo = month(m[1]);
    const b = await body<{ to: string; ack?: boolean; reason?: string }>();
    const st = await monthState(env, mo);
    const from = STATES.indexOf(st.status as (typeof STATES)[number]), to = STATES.indexOf(b.to as (typeof STATES)[number]);
    if (to < 0) throw new HttpError(400, 'Unbekannter Status.');
    const now = new Date().toISOString();
    if (to === from + 1 && to <= 2) {
      await env.DB.prepare('INSERT INTO months (month, status, updated_at) VALUES (?,?,?) ON CONFLICT(month) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at').bind(mo, b.to, now).run();
    } else if (to === 3 && from === 2) {
      const live = await liveMonth(env, mo);
      if ((live.result.warnings.length || live.unchecked.length) && b.ack !== true) throw new HttpError(409, 'Offene Hinweise müssen bestätigt werden.');
      const snapshot = JSON.stringify({ result: live.result, unchecked: live.unchecked, warnings: live.result.warnings });
      const stmts = [env.DB.prepare('INSERT INTO months (month, status, snapshot, released_by, released_at, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(month) DO UPDATE SET status = excluded.status, snapshot = excluded.snapshot, released_by = excluded.released_by, released_at = excluded.released_at, updated_at = excluded.updated_at').bind(mo, 'freigegeben', snapshot, who.email, now, now)];
      for (const r of live.result.rows) {
        const inst = r.lines.find((l) => l.code === 'WZG');
        if (inst) stmts.push(env.DB.prepare('UPDATE tool_accounts SET paid_before_cents = paid_before_cents - ? WHERE resource_id = ?').bind(inst.cents, r.resourceId));
      }
      await env.DB.batch(stmts);
    } else if (to === 4 && from === 3) {
      await env.DB.prepare('UPDATE months SET status = ?, updated_at = ? WHERE month = ?').bind('abgeschlossen', now, mo).run();
    } else if (to < from && from === 3 && who.role === 'gf') {
      const reason = text(b.reason, 300);
      const stmts = [env.DB.prepare("UPDATE months SET status = 'pruefung', snapshot = NULL, released_by = NULL, released_at = NULL, updated_at = ? WHERE month = ?").bind(now, mo)];
      if (st.snapshot) for (const r of (JSON.parse(st.snapshot) as { result: MonthResult }).result.rows) {
        const inst = r.lines.find((l) => l.code === 'WZG');
        if (inst) stmts.push(env.DB.prepare('UPDATE tool_accounts SET paid_before_cents = MAX(0, paid_before_cents + ?) WHERE resource_id = ?').bind(inst.cents, r.resourceId));
      }
      await env.DB.batch(stmts);
      await log(env, who, 'Freigabe zurückgenommen', `${mo}: ${reason}`);
    } else throw new HttpError(409, 'Dieser Statuswechsel ist nicht erlaubt.');
    await log(env, who, 'Status ' + b.to, mo);
    return reply({ ok: true });
  }
  if ((m = p.match(/^\/api\/months\/([\d-]+)\/export\.csv$/)) && method === 'GET') {
    const mo = month(m[1]);
    const st = await monthState(env, mo);
    if (!closed(st.status) || !st.snapshot) throw new HttpError(409, 'Export erst nach Freigabe möglich.');
    await log(env, who, 'Export', mo);
    return new Response(toCsv(mo, (JSON.parse(st.snapshot) as { result: MonthResult }).result), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="lohn-${mo}.csv"`, ...SECURITY },
    });
  }

  if (p === '/api/settings') {
    if (method === 'GET') return reply(await loadSettings(env));
    if (method === 'PUT') {
      const b = await body<Record<string, unknown>>();
      const allowed = ['rates', 'tiers', 'holidays', 'absenceThreshold', 'saturdayRate', 'nightPct', 'sundayPct', 'holidayPct', 'equalSplit'];
      const stmts = Object.entries(b).filter(([k]) => allowed.includes(k)).map(([k, v]) => env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, JSON.stringify(v)));
      if (stmts.length) await env.DB.batch(stmts);
      await log(env, who, 'Einstellungen geändert', Object.keys(b).join(', '));
      return reply({ ok: true });
    }
  }
  if (p === '/api/terms') {
    if (method === 'GET') {
      const emp = (await env.PLAN.prepare("SELECT id, name FROM resources WHERE kind = 'employee' AND archived_at IS NULL ORDER BY sort_order, name").all<{ id: string; name: string }>()).results;
      const { terms } = await termsFor(env, new Date().toISOString().slice(0, 7), Object.fromEntries(emp.map((e) => [e.id, e.name])));
      return reply(emp.map((e) => ({ id: e.id, ...terms[e.id] })));
    }
    if (method === 'PUT') {
      const b = await body<{ resourceId: string; validFrom: string; terms: Record<string, unknown> }>();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.validFrom)) throw new HttpError(400, 'Gültig-ab-Datum fehlt.');
      if (closed((await monthState(env, b.validFrom.slice(0, 7))).status)) throw new HttpError(409, 'Der Monat ist freigegeben. Änderungen gelten nur ab einem offenen Monat.');
      const t = b.terms, d = DEFAULT_TERMS('');
      const clean = {
        lohngruppe: t.lohngruppe === null ? null : (Number.isInteger(t.lohngruppe) && (t.lohngruppe as number) >= 1 && (t.lohngruppe as number) <= 9 ? t.lohngruppe : (() => { throw new HttpError(400, 'Lohngruppe 1 bis 9.'); })()),
        surchargeCents: cents(t.surchargeCents ?? d.surchargeCents), foreman: !!t.foreman,
        foremanCostCents: t.foremanCostCents === null || t.foremanCostCents === undefined ? null : cents(t.foremanCostCents),
        fixedSalaryCents: t.fixedSalaryCents === null || t.fixedSalaryCents === undefined ? null : cents(t.fixedSalaryCents),
        bonus: !!t.bonus, saturday: !!t.saturday,
      };
      await env.DB.prepare('INSERT INTO employee_terms (resource_id, valid_from, data) VALUES (?,?,?) ON CONFLICT(resource_id, valid_from) DO UPDATE SET data = excluded.data').bind(text(b.resourceId, 80), b.validFrom, JSON.stringify(clean)).run();
      await log(env, who, 'Konditionen geändert', `${b.resourceId} ab ${b.validFrom}`);
      return reply({ ok: true });
    }
  }
  if (p === '/api/adjustments' && method === 'POST') {
    const b = await body<{ month: string; resourceId: string; kind: string; label: string; cents: number }>();
    await assertOpen(env, month(b.month));
    const kind = ['korrektur', 'praemie', 'auslagen', 'notfall', 'sonstiges'].includes(b.kind) ? b.kind : (() => { throw new HttpError(400, 'Unbekannte Lohnart.'); })();
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO adjustments (id, month, resource_id, kind, label, cents, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, b.month, text(b.resourceId, 80), kind, text(b.label), cents(b.cents), who.email, new Date().toISOString()).run();
    await log(env, who, 'Korrektur', `${b.month} ${b.resourceId} ${b.label} ${b.cents}`);
    return reply({ id });
  }
  if ((m = p.match(/^\/api\/adjustments\/([\w-]+)$/)) && method === 'DELETE') {
    const row = await env.DB.prepare('SELECT month FROM adjustments WHERE id = ?').bind(m[1]).first<{ month: string }>();
    if (!row) throw new HttpError(404, 'Nicht gefunden.');
    await assertOpen(env, row.month);
    await env.DB.prepare('DELETE FROM adjustments WHERE id = ?').bind(m[1]).run();
    await log(env, who, 'Korrektur gelöscht', m[1]);
    return reply({ ok: true });
  }
  if (p === '/api/tools') {
    if (method === 'GET') return reply((await env.DB.prepare('SELECT * FROM tool_accounts').all()).results);
    if (method === 'PUT') {
      const b = await body<{ resourceId: string; priceCents: number; monthlyRateCents: number; prepaidCents: number }>();
      await env.DB.prepare('INSERT INTO tool_accounts (resource_id, price_cents, monthly_rate_cents, prepaid_cents) VALUES (?,?,?,?) ON CONFLICT(resource_id) DO UPDATE SET price_cents = excluded.price_cents, monthly_rate_cents = excluded.monthly_rate_cents, prepaid_cents = excluded.prepaid_cents').bind(text(b.resourceId, 80), cents(b.priceCents), cents(b.monthlyRateCents), cents(b.prepaidCents ?? 0)).run();
      await log(env, who, 'Werkzeugkonto', b.resourceId);
      return reply({ ok: true });
    }
  }
  if (p === '/api/external' && method === 'POST') {
    const b = await body<{ month: string; kw: string; minutes: number; invoicedCents: number; rateCents?: number }>();
    await assertOpen(env, month(b.month));
    if (!/^\d{4}-W\d{2}$/.test(b.kw)) throw new HttpError(400, 'KW im Format 2027-W05.');
    await env.DB.prepare('INSERT INTO external_weeks (id, month, kw, label, minutes, invoiced_cents, rate_cents) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), b.month, b.kw, 'KW ' + b.kw.slice(6), cents(b.minutes), cents(b.invoicedCents), cents(b.rateCents ?? 4000)).run();
    await log(env, who, 'Externe Woche', `${b.month} ${b.kw}`);
    return reply({ ok: true });
  }
  if ((m = p.match(/^\/api\/external\/([\w-]+)$/)) && method === 'DELETE') {
    const row = await env.DB.prepare('SELECT month FROM external_weeks WHERE id = ?').bind(m[1]).first<{ month: string }>();
    if (!row) throw new HttpError(404, 'Nicht gefunden.');
    await assertOpen(env, row.month);
    await env.DB.prepare('DELETE FROM external_weeks WHERE id = ?').bind(m[1]).run();
    return reply({ ok: true });
  }
  if (p === '/api/nu-costs' && method === 'PUT') {
    const b = await body<{ month: string; projectId: string; cents: number }>();
    await assertOpen(env, month(b.month));
    await env.DB.prepare('INSERT INTO nu_costs (project_id, month, cents) VALUES (?,?,?) ON CONFLICT(project_id, month) DO UPDATE SET cents = excluded.cents').bind(text(b.projectId, 80), b.month, cents(b.cents)).run();
    return reply({ ok: true });
  }
  if (p === '/api/roles') {
    if (who.role !== 'gf') throw new HttpError(403, 'Nur die Geschäftsführung verwaltet Zugänge.');
    if (method === 'GET') return reply((await env.DB.prepare('SELECT email, role, name FROM roles ORDER BY email').all()).results);
    if (method === 'PUT') {
      const b = await body<{ email: string; role: string; name?: string }>();
      if (!['buchhaltung', 'gf'].includes(b.role)) throw new HttpError(400, 'Rolle unbekannt.');
      await env.DB.prepare('INSERT INTO roles (email, role, name) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, name = excluded.name').bind(text(b.email, 200).toLowerCase(), b.role, b.name || '').run();
      await log(env, who, 'Zugang gesetzt', `${b.email} ${b.role}`);
      return reply({ ok: true });
    }
  }
  if (p === '/api/audit' && method === 'GET') return reply((await env.DB.prepare('SELECT at, actor, action, detail FROM audit ORDER BY at DESC LIMIT 200').all()).results);
  throw new HttpError(404, 'Nicht gefunden.');
}

export default {
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    // The source databases are never reachable through the raw bindings.
    const env: Env = { ...rawEnv, PLAN: readOnly(rawEnv.PLAN), AUFMASS: readOnly(rawEnv.AUFMASS) };
    const url = new URL(request.url);
    // Every request, pages included, needs a verified identity. Nothing is served to anonymous callers.
    if (!url.pathname.startsWith('/api/')) {
      try { await identify(request, env); } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        return new Response(status === 403 ? 'Kein Zugang zum Lohntool.' : 'Bitte anmelden.', { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY } });
      }
      const res = await env.ASSETS.fetch(request);
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(SECURITY)) h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    }
    try { return await route(request, env, url); } catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message }, e.status);
      console.error(e);
      return reply({ error: 'Interner Fehler.' }, 500);
    }
  },
};
