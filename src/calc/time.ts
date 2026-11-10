// Minutes are integers; Mo-Fr weekdays count for replacement revenue, holidays included.
export function weekdaysInMonth(year: number, month: number): number {
  let n = 0;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) {
    const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

// Absence days earn a share of the fixed monthly threshold, so absence never lowers the bonus.
export function replacementRevenue(threshold: number, year: number, month: number, absentDays: number) {
  return Math.round((threshold * absentDays) / weekdaysInMonth(year, month));
}

export type Surcharges = { night: number; sunday: number; holiday: number };
export const TARIFF_SURCHARGES: Surcharges = { night: 25, sunday: 100, holiday: 150 };

// Splits one shift (local time, ISO "YYYY-MM-DDTHH:mm") into pay categories; highest surcharge wins per minute.
export function surchargeMinutes(start: string, end: string, holidays: ReadonlySet<string>) {
  const out = { normal: 0, night: 0, sunday: 0, holiday: 0 };
  const t0 = Date.parse(start + 'Z'), t1 = Date.parse(end + 'Z');
  for (let t = t0; t < t1; t += 60_000) {
    const d = new Date(t), day = d.toISOString().slice(0, 10), h = d.getUTCHours();
    if (holidays.has(day)) out.holiday++;
    else if (d.getUTCDay() === 0) out.sunday++;
    else if (h >= 20 || h < 6) out.night++;
    else out.normal++;
  }
  return out;
}
