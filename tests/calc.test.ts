import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressiveBonus, saturdayBonus, hoursPay, nuProjectBonus, toolInstallment, externalWeek } from '../src/calc/bonus.ts';

const eur = (n: number) => Math.round(n * 100);

test('progressive bonus', () => {
  assert.equal(progressiveBonus(eur(8000)), 0);
  assert.equal(progressiveBonus(eur(10000)), eur(400));
  assert.equal(progressiveBonus(eur(12000)), eur(900));
  assert.equal(progressiveBonus(eur(15000)), eur(1850));
});

test('saturday top-up', () => {
  const pay = hoursPay(8 * 60, eur(20.37));
  assert.equal(pay, 16296);
  assert.deepEqual(saturdayBonus(eur(800), pay), { target: 32000, bonus: 15704, total: 32000 });
  assert.equal(saturdayBonus(eur(100), pay).bonus, 0);
});

test('nu project bonus', () => {
  const r = nuProjectBonus({ nuRevenue: eur(60000), nuCost: eur(40000), foremanMinutes: 100 * 60, foremanCostPerHour: eur(50) });
  assert.deepEqual(r, { profit: eur(15000), bonus: eur(1500) });
  assert.equal(nuProjectBonus({ nuRevenue: 0, nuCost: 100, foremanMinutes: 0, foremanCostPerHour: 0 }).bonus, 0);
});

test('tool account', () => {
  assert.equal(toolInstallment(eur(2500), eur(2000), 0, eur(100)).debt, eur(500));
  assert.equal(toolInstallment(eur(2500), eur(2000), eur(450), eur(100)).installment, eur(50));
  assert.equal(toolInstallment(eur(2500), eur(2000), eur(500), eur(100)).installment, 0);
});

test('external week', () => {
  assert.deepEqual(externalWeek(50 * 60, eur(40), eur(2080)), { expected: eur(2000), diff: eur(80) });
});
