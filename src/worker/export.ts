import type { MonthResult } from '../calc/month.ts';
import { LABELS, sortCodes } from '../calc/labels.ts';

const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',');
// A leading = + - @ would be run as a formula by Excel, so such cells get a quote in front.
const cell = (v: string | number) => {
  let s = String(v);
  if (/^[=+@]|^-(?!\d)/.test(s)) s = "'" + s;
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function toCsv(month: string, r: MonthResult): string {
  const codes = sortCodes(r.rows.flatMap((x) => x.lines.map((l) => l.code)));
  const label = (c: string) => LABELS[c] ?? c;
  const head = ['Monat', 'Mitarbeiter', ...codes.map(label), 'Summe Lohnarten', 'Spesen steuerfrei', 'Kilometer', 'Stunden', 'Anfahrt Stunden', 'Umsatzbasis'];
  const lines = [head.map(cell).join(';')];
  for (const x of r.rows) {
    const by = (c: string) => x.lines.filter((l) => l.code === c).reduce((n, l) => n + l.cents, 0);
    lines.push([
      month, x.name, ...codes.map((c) => eur(by(c))), eur(x.payout), eur(x.spesen), x.km.toFixed(0),
      (x.metrics.workMinutes / 60).toFixed(2).replace('.', ','), (x.metrics.travelMinutes / 60).toFixed(2).replace('.', ','), eur(x.metrics.revenue),
    ].map(cell).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
