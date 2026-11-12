import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonth, DEFAULT_SETTINGS, type Terms } from '../src/calc/month.ts';
import { computeDay } from '../src/import/plan.ts';

const terms: Terms = { name: 'Max Muster', lohngruppe: 8, surchargeCents: 0, foreman: false, foremanCostCents: null, fixedSalaryCents: null, bonus: true, saturday: true };
const base = (over: object = {}) => ({
  month: '2027-02', settings: { ...DEFAULT_SETTINGS, holidays: ['2027-01-01'] }, terms: { r1: terms }, days: {}, revenue: [], nu: [],
  foremanMinutes: {}, otherNuCosts: {}, adjustments: [], tools: {}, external: [], carryIn: {}, ...over,
});

test('bonus tiers, replacement revenue and tool installment in one month', () => {
  const absent = [1, 2].map((n) => computeDay('r1', `2027-02-0${n}`, [{ resource_id: 'r1', project_id: null, day: `2027-02-0${n}`, assignment_type: 'vacation' }], [], [], new Set()));
  const res = computeMonth(base({
    days: { r1: absent },
    revenue: [{ resourceId: 'r1', day: '2027-02-10', projectId: 'p', cents: 1_000_000, approved: true }],
    tools: { r1: { priceCents: 60000, monthlyRateCents: 5000, paidBefore: 58000, prepaid: 0 } },
  }));
  const row = res.rows[0];
  // Feb 2027 has 20 weekdays: 2 absence days add 2 x 400 EUR = 800 EUR, pot 10.800 EUR
  assert.equal(row.metrics.replacement, 80000);
  // 8-10k at 20% = 400, 10-10.8k at 25% = 200
  assert.equal(row.lines.find((l) => l.code === 'UMS')!.cents, 40000 + 20000);
  assert.equal(row.lines.find((l) => l.code === 'WZG')!.cents, -2000);
  assert.equal(row.lines.find((l) => l.code === 'ABW')!.cents, 2 * 8 * 2037);
});

test('negative bonus is carried, never taken from wages', () => {
  const res = computeMonth(base({ adjustments: [{ id: 'a', resourceId: 'r1', kind: 'korrektur', label: 'Rückbuchung', cents: -50000 }] }));
  const row = res.rows[0];
  assert.equal(row.carryOut, -50000);
  assert.equal(row.payout, 0);
});

test('NU bonus goes to the foreman by default', () => {
  const t = { ...terms, foreman: true, foremanCostCents: 3000 };
  const nu = [{ projectId: 'p', projectName: 'NU Haus', foremanId: 'r1', revenue: 500000, cost: 300000, approved: true }];
  const ok = computeMonth(base({ terms: { r1: t }, nu, foremanMinutes: { r1: { p: 600 } } }));
  // profit = 5000 - 3000 - 10 h x 30 = 1700, bonus 10% = 170
  assert.equal(ok.nu[0].bonus, 17000);
  assert.equal(ok.rows[0].lines.find((l) => l.code === 'NU')!.cents, 17000);
  const noRate = computeMonth(base({ terms: { r1: terms }, nu }));
  assert.equal(noRate.nu[0].bonus, 20000); // no cost rate: profit 2000, bonus 200
  assert.ok(!/Kostensatz/.test(noRate.warnings.join()));
});

test('missing holidays warn, external week difference is reported', () => {
  const res = computeMonth(base({ settings: DEFAULT_SETTINGS, external: [{ id: 'w', kw: '2027-W06', label: 'KW 06', minutes: 40 * 60, invoiced: 168000, ratePerHour: 4000 }] }));
  assert.match(res.warnings.join(), /Feiertage/);
  assert.equal(res.external[0].diff, 8000);
});

test('weekend absence is not paid as a workday', () => {
  const sat = computeDay('r1', '2027-02-06', [{ resource_id: 'r1', project_id: null, day: '2027-02-06', assignment_type: 'vacation' }], [], [], new Set());
  const res = computeMonth(base({ days: { r1: [sat] } }));
  assert.equal(res.rows[0].lines.find((l) => l.code === 'ABW'), undefined);
  assert.equal(res.rows[0].metrics.absentDays, 0);
});

test('NU bonus can be assigned and split between two people', () => {
  const nu = [{ projectId: 'p', projectName: 'NU Haus', foremanId: null, revenue: 500000, cost: 300000, approved: true }];
  const r = computeMonth(base({ terms: { r1: terms, r2: { ...terms, name: 'Zwei' } }, nu, nuAssign: { p: { firstId: 'r1', secondId: 'r2', secondPct: 30 } } }));
  assert.equal(r.rows.find((x) => x.resourceId === 'r1')!.lines.find((l) => l.code === 'NU')!.cents, 14000);
  assert.equal(r.rows.find((x) => x.resourceId === 'r2')!.lines.find((l) => l.code === 'NU')!.cents, 6000);
});
