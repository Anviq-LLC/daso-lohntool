import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekdaysInMonth, replacementRevenue, surchargeMinutes } from '../src/calc/time.ts';

test('replacement revenue', () => {
  assert.equal(weekdaysInMonth(2027, 2), 20);
  assert.equal(replacementRevenue(800_000, 2027, 2, 1), 40_000);
  assert.equal(weekdaysInMonth(2027, 3), 23);
  assert.equal(replacementRevenue(800_000, 2027, 3, 1), 34_783);
});

test('surcharge split', () => {
  const none = new Set<string>();
  assert.deepEqual(surchargeMinutes('2027-01-04T07:00', '2027-01-04T15:00', none), { normal: 480, night: 0, sunday: 0, holiday: 0 });
  assert.equal(surchargeMinutes('2027-01-04T19:00', '2027-01-04T22:00', none).night, 120);
  assert.equal(surchargeMinutes('2027-01-03T08:00', '2027-01-03T10:00', none).sunday, 120);
  assert.equal(surchargeMinutes('2027-01-06T08:00', '2027-01-06T10:00', new Set(['2027-01-06'])).holiday, 120);
});
