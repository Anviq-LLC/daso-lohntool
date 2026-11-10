// Loads one month from the three databases and runs the calculation.
import { computeMonth, DEFAULT_SETTINGS, type Adjustment, type ExternalWeek, type MonthResult, type Settings, type Terms, type ToolAccount } from '../calc/month.ts';
import { computeDay, daysOfMonth, berlinDay, type Assignment, type DayEntry, type Punch, type Day } from '../import/plan.ts';
import { importAufmass, parseRecords } from '../import/aufmass.ts';
import type { Env } from './auth.ts';

export const DEFAULT_TERMS = (name: string): Terms => ({
  name, lohngruppe: null, surchargeCents: 0, foreman: false, foremanCostCents: null, fixedSalaryCents: null, bonus: true, saturday: true,
});

export async function loadSettings(env: Env): Promise<Settings & { equalSplit: boolean }> {
  const rows = (await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()).results;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const j = <T>(k: string, d: T): T => { try { return m[k] ? JSON.parse(m[k]) : d; } catch { return d; } };
  return {
    ...DEFAULT_SETTINGS,
    rates: j('rates', DEFAULT_SETTINGS.rates), tiers: j('tiers', DEFAULT_SETTINGS.tiers), holidays: j('holidays', []),
    absenceThreshold: j('absenceThreshold', DEFAULT_SETTINGS.absenceThreshold), saturdayRate: j('saturdayRate', 40),
    nightPct: j('nightPct', 25), sundayPct: j('sundayPct', 100), holidayPct: j('holidayPct', 150),
    equalSplit: j('equalSplit', false),
  };
}

export const prevMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
};

export async function termsFor(env: Env, month: string, names: Record<string, string>) {
  const end = month + '-31';
  const rows = (await env.DB.prepare('SELECT resource_id, valid_from, data FROM employee_terms WHERE valid_from <= ? ORDER BY valid_from').bind(end).all<{ resource_id: string; valid_from: string; data: string }>()).results;
  const terms: Record<string, Terms> = {};
  const changed: string[] = [];
  for (const [id, name] of Object.entries(names)) terms[id] = DEFAULT_TERMS(name);
  for (const r of rows) {
    if (!(r.resource_id in names)) continue;
    terms[r.resource_id] = { ...DEFAULT_TERMS(names[r.resource_id]), ...JSON.parse(r.data), name: names[r.resource_id] };
    if (r.valid_from > month + '-01') changed.push(names[r.resource_id]);
  }
  return { terms, changed };
}

export async function liveMonth(env: Env, month: string) {
  const plan = env.PLAN, aufmass = env.AUFMASS;
  const first = month + '-01', last = month + '-31';
  const lo = new Date(Date.parse(first + 'T00:00:00Z') - 2 * 86400000).toISOString();
  const [y, mo] = month.split('-').map(Number);
  const hi = new Date(Date.UTC(y, mo, 3)).toISOString();
  const [res, ass, pun, ent, proj, am] = await Promise.all([
    plan.prepare("SELECT id, name, role FROM resources WHERE kind = 'employee' AND archived_at IS NULL ORDER BY sort_order, name").all<{ id: string; name: string; role: string }>(),
    plan.prepare('SELECT resource_id, project_id, day, assignment_type FROM assignments WHERE day >= ? AND day <= ?').bind(first, last).all<Assignment>(),
    plan.prepare('SELECT resource_id, project_id, started, ended, pause FROM punches WHERE started >= ? AND started <= ?').bind(lo, hi).all<Punch>(),
    plan.prepare('SELECT resource_id, day, data FROM day_entries WHERE day >= ? AND day <= ?').bind(first, last).all<DayEntry>(),
    plan.prepare('SELECT id, name, foreman_id FROM projects').all<{ id: string; name: string; foreman_id: string | null }>(),
    aufmass.prepare("SELECT id, kind, data FROM records WHERE kind = 'project' OR (kind = 'report' AND json_extract(data, '$.date') <= ? AND COALESCE(json_extract(data, '$.endDate'), json_extract(data, '$.date')) >= ?)").bind(new Date(Date.parse(first + 'T00:00:00Z') + 110 * 86400000).toISOString().slice(0, 10), new Date(Date.parse(first + 'T00:00:00Z') - 8 * 86400000).toISOString().slice(0, 10)).all<{ id: string; kind: string; data: string }>(),
  ]);
  const settings = await loadSettings(env);
  const holidays = new Set(settings.holidays);
  const names = Object.fromEntries(res.results.map((r) => [r.id, r.name]));
  const { terms, changed } = await termsFor(env, month, names);

  const days: Record<string, Day[]> = {};
  const foremanMinutes: Record<string, Record<string, number>> = {};
  for (const r of res.results) {
    days[r.id] = daysOfMonth(month).map((d) => computeDay(r.id, d, ass.results, pun.results, ent.results, holidays));
  }
  for (const p of pun.results) {
    if (!p.ended || !p.project_id || !berlinDay(p.started).startsWith(month)) continue;
    const mins = Math.max(0, (Date.parse(p.ended) - Date.parse(p.started)) / 60000 - (p.pause || 0));
    const mine = (foremanMinutes[p.resource_id] ||= {});
    mine[p.project_id] = (mine[p.project_id] || 0) + mins;
  }

  const imp = importAufmass(parseRecords(am.results), month, { allowEqualSplit: settings.equalSplit });
  const foremanOf = new Map(proj.results.map((p) => [p.id, p.foreman_id]));
  imp.nu = imp.nu.map((n) => ({ ...n, foremanId: foremanOf.get(n.projectId) ?? null }));
  const unknown = imp.revenue.filter((r) => !(r.resourceId in names));
  const revenue = imp.revenue.filter((r) => r.resourceId in names);
  const warnings = [...imp.warnings];
  if (unknown.length) warnings.push(`${unknown.length} Umsatzzeilen gehören zu Personen, die in der Montageplanung nicht (mehr) als Mitarbeiter geführt werden.`);
  if (changed.length) warnings.push(`Konditionen ändern sich im Monat (gelten für den ganzen Monat): ${changed.join(', ')}.`);
  const unchecked = [...new Map(imp.unchecked.map((u) => [u.day + u.project, u])).values()].sort((a, b) => a.day.localeCompare(b.day));

  const adj = (await env.DB.prepare('SELECT id, resource_id, kind, label, cents FROM adjustments WHERE month = ?').bind(month).all<{ id: string; resource_id: string; kind: string; label: string; cents: number }>()).results
    .map((a): Adjustment => ({ id: a.id, resourceId: a.resource_id, kind: a.kind, label: a.label, cents: a.cents }));
  const tools: Record<string, ToolAccount> = {};
  for (const t of (await env.DB.prepare('SELECT * FROM tool_accounts').all<{ resource_id: string; price_cents: number; monthly_rate_cents: number; paid_before_cents: number; prepaid_cents: number }>()).results)
    tools[t.resource_id] = { priceCents: t.price_cents, monthlyRateCents: t.monthly_rate_cents, paidBefore: t.paid_before_cents, prepaid: t.prepaid_cents };
  const external = (await env.DB.prepare('SELECT * FROM external_weeks WHERE month = ? ORDER BY kw').bind(month).all<{ id: string; kw: string; label: string; minutes: number; invoiced_cents: number; rate_cents: number }>()).results
    .map((e): ExternalWeek => ({ id: e.id, kw: e.kw, label: e.label, minutes: e.minutes, invoiced: e.invoiced_cents, ratePerHour: e.rate_cents }));
  const otherNuCosts = Object.fromEntries((await env.DB.prepare('SELECT project_id, cents FROM nu_costs WHERE month = ?').bind(month).all<{ project_id: string; cents: number }>()).results.map((r) => [r.project_id, r.cents]));
  const prev = await env.DB.prepare('SELECT snapshot FROM months WHERE month = ?').bind(prevMonth(month)).first<{ snapshot: string | null }>();
  const carryIn: Record<string, number> = {};
  if (prev?.snapshot) for (const r of (JSON.parse(prev.snapshot) as { result: MonthResult }).result.rows) if (r.carryOut) carryIn[r.resourceId] = r.carryOut;

  const result = computeMonth({ month, settings, terms, days, revenue, nu: imp.nu, foremanMinutes, otherNuCosts, adjustments: adj, tools, external, carryIn, importWarnings: warnings });
  // Employees without any hours, terms or revenue in the month only add noise.
  result.rows = result.rows.filter((r) => r.metrics.workMinutes || r.metrics.revenue || r.lines.length || terms[r.resourceId].lohngruppe || terms[r.resourceId].fixedSalaryCents !== null);
  return { result, unchecked, roles: Object.fromEntries(res.results.map((r) => [r.id, r.role])), employees: res.results };
}
