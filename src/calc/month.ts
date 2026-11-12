// Pure monthly payroll preparation. All money in cents, all time in minutes.
import { hoursPay, progressiveBonus, saturdayBonus, nuProjectBonus, toolInstallment, externalWeek, STANDARD_TIERS, type Tier } from './bonus.ts';
import { replacementRevenue, weekdaysInMonth } from './time.ts';
import type { Day } from '../import/plan.ts';
import { dow } from '../import/plan.ts';
import { de, deEur } from './labels.ts';

export type Terms = {
  name: string;
  lohngruppe: number | null;
  surchargeCents: number; // Lohnzuschlag per hour
  foreman: boolean;
  foremanCostCents: number | null;
  fixedSalaryCents: number | null;
  bonus: boolean;
  saturday: boolean;
  sub?: boolean; // external hourly worker, paid by invoice, no bonus
  subRateCents?: number | null;
};
export type Settings = {
  rates: Record<number, number>; // Lohngruppe -> cents/h
  tiers: Tier[];
  absenceThreshold: number; // cents, default 8000 EUR
  saturdayRate: number; // percent
  holidays: string[];
  nightPct: number; sundayPct: number; holidayPct: number;
};
export const DEFAULT_SETTINGS: Settings = {
  rates: { 1: 1470, 2: 1516, 3: 1570, 4: 1627, 5: 1720, 6: 1809, 7: 1898, 8: 2037, 9: 2262 },
  tiers: STANDARD_TIERS, absenceThreshold: 800_000, saturdayRate: 40, holidays: [],
  nightPct: 25, sundayPct: 100, holidayPct: 150,
};
export type RevenueRow = { resourceId: string; day: string; projectId: string; label?: string; cents: number; approved: boolean };
export type NuRow = { projectId: string; projectName: string; foremanId: string | null; revenue: number; cost: number | null; approved: boolean };
export type NuAssign = { firstId: string | null; secondId: string | null; secondPct: number };
export type ToolAccount = { priceCents: number; monthlyRateCents: number; paidBefore: number; prepaid: number };
export type Adjustment = { id: string; resourceId: string; kind: string; label: string; cents: number; taxable?: boolean };
export type ExternalWeek = { id: string; kw: string; label: string; minutes: number; invoiced: number; ratePerHour: number };

export type CalendarDay = { day: string; workMinutes: number; absence: string; revenue: { label: string; cents: number }[]; flag: '' | 'gap' | 'error'; note: string };
export type Line = { code: string; label: string; cents: number; note?: string };
export type Row = {
  resourceId: string; name: string; lines: Line[];
  payout: number; spesen: number; km: number;
  calendar?: CalendarDay[];
  weeks?: { kw: string; workMinutes: number; travelMinutes: number; cents: number }[];
  metrics: { workMinutes: number; travelMinutes: number; absentDays: number; revenue: number; saturdayRevenue: number; replacement: number };
  carryOut: number; warnings: string[];
};
export type MonthResult = {
  month: string; rows: Row[]; nu: { projectId: string; projectName: string; foremanId: string | null; revenue: number; cost: number | null; profit: number | null; bonus: number; firstId: string | null; secondId: string | null; secondPct: number }[];
  external: (ExternalWeek & { expected: number; diff: number })[]; warnings: string[];
};

function isoWeek(day: string) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // Thursday decides the year
  const y = d.getUTCFullYear();
  const w = 1 + Math.floor((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
const sum = (a: number[]) => a.reduce((n, v) => n + v, 0);

export function computeMonth(input: {
  month: string; settings: Settings; terms: Record<string, Terms>; days: Record<string, Day[]>;
  revenue: RevenueRow[]; nu: NuRow[]; foremanMinutes: Record<string, Record<string, number>>; // foremanId -> projectId -> minutes
  otherNuCosts: Record<string, number>; nuAssign?: Record<string, NuAssign>; adjustments: Adjustment[]; tools: Record<string, ToolAccount>;
  external: ExternalWeek[]; carryIn: Record<string, number>; importWarnings?: string[];
}): MonthResult {
  const { month, settings: s } = input;
  const [y, m] = month.split('-').map(Number);
  const holidays = new Set(s.holidays);
  const warnings = [...(input.importWarnings || [])];
  if (!s.holidays.length) warnings.push('Feiertage sind nicht hinterlegt: Zuschläge und Ersatzumsatz für Feiertage fehlen.');

  const nu = input.nu.map((n) => {
    const a = input.nuAssign?.[n.projectId];
    const firstId = a?.firstId ?? n.foremanId;
    const secondId = a?.secondId ?? null, secondPct = secondId ? Math.min(100, Math.max(0, a?.secondPct ?? 0)) : 0;
    const base = { ...n, firstId, secondId, secondPct };
    if (n.cost === null) { warnings.push(`NU-Projekt ${n.projectName}: Kosten unvollständig, kein Bonus.`); return { ...base, profit: null, bonus: 0 }; }
    const costRate = (n.foremanId && input.terms[n.foremanId]?.foremanCostCents) || 0;
    const fm = n.foremanId ? input.foremanMinutes[n.foremanId]?.[n.projectId] || 0 : 0;
    const r = nuProjectBonus({ nuRevenue: n.revenue, nuCost: n.cost, foremanMinutes: fm, foremanCostPerHour: costRate, otherCost: input.otherNuCosts[n.projectId] || 0 });
    return { ...base, profit: r.profit, bonus: r.bonus };
  });
  const nuByPerson: Record<string, { label: string; cents: number }[]> = {};
  for (const n of nu) {
    if (!n.bonus) continue;
    if (!n.firstId) { warnings.push(`NU-Projekt ${n.projectName}: kein Empfänger für den Bonus.`); continue; }
    const second = n.secondId ? Math.round((n.bonus * n.secondPct) / 100) : 0;
    (nuByPerson[n.firstId] ||= []).push({ label: `NU-Bonus ${n.projectName}`, cents: n.bonus - second });
    if (n.secondId && second) (nuByPerson[n.secondId] ||= []).push({ label: `NU-Bonus ${n.projectName} (${n.secondPct} %)`, cents: second });
  }

  const rows: Row[] = Object.entries(input.terms).map(([id, t]) => {
    const w: string[] = [];
    const days = input.days[id] || [];
    const rate = t.lohngruppe ? (s.rates[t.lohngruppe] ?? 0) + t.surchargeCents : 0;
    if (t.fixedSalaryCents === null && !t.lohngruppe) w.push('Keine Lohngruppe hinterlegt.');
    const lines: Line[] = [];
    let workMin = 0, realMin = 0, travelMin = 0, absentDays = 0, spesen = 0, km = 0, satMin = 0;
    const cat = { normal: 0, night: 0, sunday: 0, holiday: 0 };
    let paidAbsenceMin = 0;
    for (const d of days) {
      km += d.km;
      spesen += d.mealCents;
      for (const k of Object.keys(cat) as (keyof typeof cat)[]) cat[k] += d.surcharge[k];
      workMin += d.workMinutes;
      if (!d.absent) realMin += d.workMinutes;
      travelMin += d.travelMinutes;
      if (dow(d.day) === 6) satMin += d.surcharge.normal;
      const weekday = dow(d.day) >= 1 && dow(d.day) <= 5;
      const holidayOff = weekday && holidays.has(d.day) && !d.workMinutes;
      if (d.absent || holidayOff) {
        if (weekday) absentDays++;
        if (weekday && d.type !== 'unpaid') paidAbsenceMin += 480;
      }
      for (const x of d.warnings) w.push(`${d.day}: ${x}`);
    }
    if (t.sub) {
      const subRate = t.subRateCents ?? 0;
      if (t.subRateCents == null) w.push('Kein Stundensatz hinterlegt.');
      const byWeek = new Map<string, { kw: string; workMinutes: number; travelMinutes: number; cents: number }>();
      let subWork = 0;
      for (const d of days) {
        const wk = isoWeek(d.day), e = byWeek.get(wk) || { kw: wk, workMinutes: 0, travelMinutes: 0, cents: 0 };
        const work = d.absent ? 0 : d.workMinutes;
        e.workMinutes += work; e.travelMinutes += d.travelMinutes; subWork += work;
        byWeek.set(wk, e);
      }
      const weeks = [...byWeek.values()].filter((e) => e.workMinutes || e.travelMinutes).sort((a, b) => a.kw.localeCompare(b.kw));
      for (const e of weeks) e.cents = hoursPay(e.workMinutes + e.travelMinutes, subRate);
      lines.push({ code: 'SUBH', label: 'SUB Stunden', cents: hoursPay(subWork, subRate), note: `${de(subWork / 60)} h` });
      if (travelMin) lines.push({ code: 'SUBA', label: 'SUB Anfahrt', cents: hoursPay(travelMin, subRate), note: `${de(travelMin / 60)} h` });
      return {
        resourceId: id, name: t.name, lines, payout: sum(lines.map((l) => l.cents)), spesen, km, weeks,
        metrics: { workMinutes: subWork, travelMinutes: travelMin, absentDays, revenue: 0, saturdayRevenue: 0, replacement: 0 }, carryOut: 0, warnings: w,
      };
    }
    const normalPay = cat.normal;
    if (t.fixedSalaryCents !== null) {
      lines.push({ code: 'FIX', label: 'Festgehalt', cents: t.fixedSalaryCents });
    } else {
      const base = rate;
      if (normalPay) lines.push({ code: 'LOHN', label: 'Stundenlohn', cents: hoursPay(normalPay, base), note: `${de(normalPay / 60)} h` });
      const z = [['night', s.nightPct, 'Nachtzuschlag'], ['sunday', s.sundayPct, 'Sonntag'], ['holiday', s.holidayPct, 'Feiertag']] as const;
      for (const [k, pct, label] of z) if (cat[k]) lines.push({ code: 'ZUS_' + k.toUpperCase(), label, cents: hoursPay(cat[k], Math.round((base * (100 + pct)) / 100)), note: `${de(cat[k] / 60)} h inkl. ${pct} %` });
      if (paidAbsenceMin) lines.push({ code: 'ABW', label: 'Urlaub, Krank, Feiertag', cents: hoursPay(paidAbsenceMin, base), note: `${paidAbsenceMin / 480} Tage` });
      if (t.foreman && travelMin) lines.push({ code: 'ANF', label: 'Anfahrt Obermonteur', cents: hoursPay(travelMin, base), note: `${de(travelMin / 60)} h` });
    }

    const mine = input.revenue.filter((r) => r.resourceId === id);
    const satRev = sum(mine.filter((r) => dow(r.day) === 6).map((r) => r.cents));
    const weekRev = sum(mine.filter((r) => dow(r.day) !== 6).map((r) => r.cents));
    const ABSENCE: Record<string, string> = { vacation: 'Urlaub', sick: 'Krank', unpaid: 'Unbezahlt' };
    const calendar: CalendarDay[] = days.map((d) => {
      const rev = mine.filter((r) => r.day === d.day).map((r) => ({ label: r.label || r.projectId, cents: r.cents }));
      const weekday = dow(d.day) >= 1 && dow(d.day) <= 5;
      const worked = !d.absent && d.workMinutes > 0;
      let flag: CalendarDay['flag'] = '', note = '';
      if (rev.length && !worked) { flag = 'error'; note = 'Umsatz ohne Stunden'; }
      else if (worked && !rev.length) { flag = 'gap'; note = 'Stunden ohne Umsatz'; }
      else if (weekday && !d.absent && !d.workMinutes && !holidays.has(d.day)) { flag = 'gap'; note = 'Kein Eintrag'; }
      if (d.warnings.length) { flag = 'error'; note = [note, ...d.warnings].filter(Boolean).join(', '); }
      return { day: d.day, workMinutes: d.workMinutes, absence: d.absent ? ABSENCE[d.type] || d.type : '', revenue: rev, flag, note };
    });
    const repl = replacementRevenue(s.absenceThreshold, y, m, absentDays);
    const pot = weekRev + (t.bonus ? repl : 0);
    let bonus = 0;
    if (t.bonus && t.fixedSalaryCents === null) {
      bonus = progressiveBonus(pot, s.tiers);
      if (bonus) lines.push({ code: 'UMS', label: 'Umsatzbonus', cents: bonus, note: `Umsatz ${deEur(pot)}` });
      if (t.saturday && (satRev || satMin)) {
        const sat = saturdayBonus(satRev, hoursPay(satMin, rate), s.saturdayRate);
        if (sat.bonus) lines.push({ code: 'SAM', label: 'Samstagsbonus', cents: sat.bonus, note: `Samstagsumsatz ${deEur(satRev)}` });
      }
    }
    for (const b of nuByPerson[id] || []) lines.push({ code: 'NU', label: b.label, cents: b.cents });
    for (const a of input.adjustments.filter((x) => x.resourceId === id)) lines.push({ code: a.kind.toUpperCase(), label: a.label, cents: a.cents });

    const carry = input.carryIn[id] || 0;
    if (carry) lines.push({ code: 'VORTRAG', label: 'Übertrag Vormonat', cents: carry });

    const tool = input.tools[id];
    if (tool) {
      const t2 = toolInstallment(tool.priceCents, tool.paidBefore + tool.prepaid, 0, tool.monthlyRateCents);
      if (t2.installment) lines.push({ code: 'WZG', label: 'Werkzeugrate', cents: -t2.installment, note: `Restschuld danach ${deEur(t2.debt - t2.installment)}` });
    }

    // Corrections may push the bonus part negative. Nothing is clawed back from wages, the minus moves on.
    const bonusLike = lines.filter((l) => ['UMS', 'SAM', 'NU', 'KORREKTUR', 'VORTRAG'].includes(l.code));
    const bonusSum = sum(bonusLike.map((l) => l.cents));
    let carryOut = 0;
    if (bonusSum < 0) {
      carryOut = bonusSum;
      lines.push({ code: 'SALDO', label: 'Negativer Bonus wird übertragen', cents: -bonusSum });
    }
    if (!mine.length && t.bonus && t.fixedSalaryCents === null && realMin) w.push('Kein Umsatz zugeordnet.');
    return {
      resourceId: id, name: t.name, lines, payout: 0, spesen, km, calendar,
      metrics: { workMinutes: workMin, travelMinutes: travelMin, absentDays, revenue: pot, saturdayRevenue: satRev, replacement: t.bonus ? repl : 0 },
      carryOut, warnings: w,
    };
  });

  for (const r of rows) {
    r.payout = sum(r.lines.map((l) => l.cents));
  }
  const external = input.external.map((e) => ({ ...e, ...externalWeek(e.minutes, e.ratePerHour, e.invoiced) }));
  for (const e of external) if (e.diff !== 0) warnings.push(`${e.label}: Differenz ${deEur(e.diff)} zwischen Rechnung und Stunden.`);
  return { month, rows, nu, external, warnings };
}

export { weekdaysInMonth };
