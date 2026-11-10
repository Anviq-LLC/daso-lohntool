import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonth, DEFAULT_SETTINGS, type Terms } from '../src/calc/month.ts';
import { computeDay, daysOfMonth, dow } from '../src/import/plan.ts';
import { toCsv } from '../src/worker/export.ts';
import { de, deEur, sortCodes, LABELS } from '../src/calc/labels.ts';
import { progressiveBonus, saturdayBonus, toolInstallment, hoursPay } from '../src/calc/bonus.ts';
import { weekdaysInMonth } from '../src/calc/time.ts';

const terms: Terms = { name: 'Test Person', lohngruppe: 4, surchargeCents: 0, foreman: false, foremanCostCents: null, fixedSalaryCents: null, bonus: true, saturday: true };
const base = (over: object = {}) => ({
  month: '2027-02', settings: { ...DEFAULT_SETTINGS, holidays: ['2027-01-01'] }, terms: { r1: terms }, days: {}, revenue: [], nu: [],
  foremanMinutes: {}, otherNuCosts: {}, adjustments: [], tools: {}, external: [], carryIn: {}, ...over,
});
const punch = (a: string, b: string, pause = 0) => ({ resource_id: 'r1', project_id: 'p', started: a, ended: b, pause });

test('Sunday work earns 100 % surcharge, holiday work 150 %', () => {
  const sun = computeDay('r1', '2027-02-07', [], [punch('2027-02-07T07:00:00Z', '2027-02-07T15:00:00Z')], [], new Set());
  assert.equal(sun.surcharge.sunday, 480);
  const hol = computeDay('r1', '2027-02-02', [], [punch('2027-02-02T07:00:00Z', '2027-02-02T15:00:00Z')], [], new Set(['2027-02-02']));
  assert.equal(hol.surcharge.holiday, 480);
  const res = computeMonth(base({ days: { r1: [sun, hol] } }));
  const rate = 1627;
  assert.equal(res.rows[0].lines.find((l) => l.code === 'ZUS_SUNDAY')!.cents, hoursPay(480, rate * 2));
  assert.equal(res.rows[0].lines.find((l) => l.code === 'ZUS_HOLIDAY')!.cents, hoursPay(480, Math.round(rate * 2.5)));
});

test('pause is taken out of the paid time', () => {
  const d = computeDay('r1', '2027-02-02', [], [punch('2027-02-02T07:00:00Z', '2027-02-02T16:00:00Z', 60)], [], new Set());
  assert.equal(d.workMinutes, 480);
  assert.equal(d.surcharge.normal, 480);
});

test('open punch is flagged and not counted', () => {
  const d = computeDay('r1', '2027-02-02', [], [{ resource_id: 'r1', project_id: 'p', started: '2027-02-02T07:00:00Z', ended: null, pause: null }], [], new Set());
  assert.equal(d.workMinutes, 0);
  assert.ok(d.warnings.includes('Offene Stempelung'));
});

test('broken day entry is treated as empty', () => {
  const d = computeDay('r1', '2027-02-02', [], [punch('2027-02-02T07:00:00Z', '2027-02-02T15:00:00Z')], [{ resource_id: 'r1', day: '2027-02-02', data: '{not json' }], new Set());
  assert.equal(d.workMinutes, 480);
});

test('manual hours override the stamped time and are flagged', () => {
  const d = computeDay('r1', '2027-02-02', [], [punch('2027-02-02T07:00:00Z', '2027-02-02T15:00:00Z')], [{ resource_id: 'r1', day: '2027-02-02', data: JSON.stringify({ workHours: '6' }) }], new Set());
  assert.equal(d.workMinutes, 360);
  assert.ok(d.warnings.some((w) => w.includes('manuell')));
});

test('fixed salary has no hourly wage and no bonus', () => {
  const t = { ...terms, fixedSalaryCents: 300000, lohngruppe: null };
  const res = computeMonth(base({ terms: { r1: t }, revenue: [{ resourceId: 'r1', day: '2027-02-10', projectId: 'p', cents: 2_000_000, approved: true }] }));
  assert.deepEqual(res.rows[0].lines.map((l) => l.code), ['FIX']);
  assert.equal(res.rows[0].payout, 300000);
});

test('employee without a Lohngruppe is flagged', () => {
  const res = computeMonth(base({ terms: { r1: { ...terms, lohngruppe: null } } }));
  assert.ok(res.rows[0].warnings.some((w) => w.includes('Lohngruppe')));
});

test('carry from the previous month is added and a later negative sum is carried again', () => {
  const res = computeMonth(base({ carryIn: { r1: -20000 }, adjustments: [{ id: 'a', resourceId: 'r1', kind: 'korrektur', label: 'x', cents: -5000 }] }));
  assert.equal(res.rows[0].carryOut, -25000);
  assert.equal(res.rows[0].payout, 0);
});

test('tool installment stops when the debt is paid', () => {
  assert.deepEqual(toolInstallment(60000, 55000, 0, 5000), { debt: 5000, installment: 5000 });
  assert.deepEqual(toolInstallment(60000, 60000, 0, 5000), { debt: 0, installment: 0 });
  const res = computeMonth(base({ tools: { r1: { priceCents: 60000, monthlyRateCents: 5000, paidBefore: 40000, prepaid: 20000 } } }));
  assert.equal(res.rows[0].lines.find((l) => l.code === 'WZG'), undefined);
});

test('bonus tier edges', () => {
  assert.equal(progressiveBonus(799_999), 0);
  assert.equal(progressiveBonus(800_100), 20);
  assert.equal(progressiveBonus(1_400_000), 150000);
  assert.equal(saturdayBonus(0, 5000).bonus, 0);
});

test('calendar helpers', () => {
  assert.equal(daysOfMonth('2028-02').length, 29);
  assert.equal(dow('2027-02-06'), 6);
  assert.equal(weekdaysInMonth(2027, 2), 20);
});

test('formatting helpers use German notation', () => {
  assert.equal(de(46.5), '46,50');
  assert.match(deEur(1800000), /18\.000,00/);
  assert.ok(sortCodes(['WZG', 'UMS', 'LOHN'])[0] === 'LOHN');
});

test('CSV: fixed headers, German decimals, formula injection defused, quotes escaped', () => {
  const res = computeMonth(base({
    terms: { r1: { ...terms, name: '=HYPERLINK("x")' }, r2: { ...terms, name: 'Anna; "Test"' } },
    adjustments: [{ id: 'a', resourceId: 'r1', kind: 'korrektur', label: 'Freitext Januar', cents: 1250 }],
  }));
  const csv = toCsv('2027-02', res);
  const lines = csv.split('\r\n');
  assert.ok(csv.startsWith('﻿'));
  assert.ok(lines[0].includes(LABELS.KORREKTUR));
  assert.ok(!lines[0].includes('Freitext'));
  assert.ok(lines[1].includes("'=HYPERLINK"));
  assert.ok(lines[1].includes('12,50'));
  assert.ok(lines[2].includes('"Anna; ""Test"""'));
});
