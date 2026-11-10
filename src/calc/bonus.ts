// All money is integer cents. Rates are whole percent.
export type Tier = { from: number; rate: number };

export const STANDARD_TIERS: Tier[] = [
  { from: 800_000, rate: 20 },
  { from: 1_000_000, rate: 25 },
  { from: 1_200_000, rate: 30 },
  { from: 1_400_000, rate: 35 },
];

// Each tier pays its rate only on the revenue that falls inside it.
export function progressiveBonus(revenue: number, tiers: Tier[] = STANDARD_TIERS): number {
  const sorted = [...tiers].sort((a, b) => a.from - b.from);
  let sum = 0;
  sorted.forEach((t, i) => {
    const to = sorted[i + 1]?.from ?? Infinity;
    sum += Math.round((Math.max(0, Math.min(revenue, to) - t.from) * t.rate) / 100);
  });
  return sum;
}

// Saturday is its own pot: top up to 40% of Saturday revenue, never below the owed pay.
export function saturdayBonus(saturdayRevenue: number, creditedPay: number, rate = 40) {
  const target = Math.round((saturdayRevenue * rate) / 100);
  const bonus = Math.max(0, target - creditedPay);
  return { target, bonus, total: creditedPay + bonus };
}

export const hoursPay = (minutes: number, centsPerHour: number) =>
  Math.round((minutes * centsPerHour) / 60);

export function nuProjectBonus(p: {
  nuRevenue: number;
  nuCost: number;
  foremanMinutes: number;
  foremanCostPerHour: number;
  otherCost?: number;
}) {
  const profit =
    p.nuRevenue - p.nuCost - hoursPay(p.foremanMinutes, p.foremanCostPerHour) - (p.otherCost ?? 0);
  return { profit, bonus: Math.round(Math.max(0, profit) * 0.1) };
}

// Installment never exceeds the remaining debt; prepayments outside payroll only reduce debt.
export function toolInstallment(price: number, paidBefore: number, booked: number, monthlyRate: number) {
  const debt = Math.max(0, price - paidBefore - booked);
  return { debt, installment: Math.min(monthlyRate, debt) };
}

export function externalWeek(minutes: number, centsPerHour: number, invoiced: number) {
  const expected = hoursPay(minutes, centsPerHour);
  return { expected, diff: invoiced - expected };
}
