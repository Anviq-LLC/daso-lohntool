// Steuerberater sheet: columns that come from the month calculation can be overridden, the rest is typed in per month.
import type { Row } from './month.ts';

export type Inputs = Record<string, number>;
type Col = { key: string; label: string; auto?: (r: Row) => number };
const sum = (r: Row, codes: string[]) => r.lines.filter((l) => codes.includes(l.code)).reduce((n, l) => n + l.cents, 0);

export const GROSS: Col[] = [
  { key: 'grundgehalt', label: 'Grundgehalt', auto: (r) => sum(r, ['FIX', 'LOHN', 'ZUS_NIGHT', 'ZUS_SUNDAY', 'ZUS_HOLIDAY', 'ABW', 'ANF']) },
  { key: 'umsatzbonus', label: 'Umsatzbonus', auto: (r) => sum(r, ['UMS', 'SAM']) },
  { key: 'bauleiter', label: 'Bauleiterbonus', auto: (r) => sum(r, ['NU']) },
  { key: 'sonstiges', label: 'Korrektur, Prämie', auto: (r) => sum(r, ['KORREKTUR', 'PRAEMIE', 'SONSTIGES', 'VORTRAG', 'SALDO']) },
];
export const MONEY: Col[] = [
  { key: 'vl', label: 'VL' }, { key: 'fitness', label: 'Fitness' }, { key: 'firmenwagen', label: 'Firmenwagen 1 % Betrag' },
  { key: 'notfall', label: 'Notfall Zusatzgeld netto', auto: (r) => sum(r, ['NOTFALL']) },
  { key: 'werkzeugAbzug', label: 'Werkzeug Abzug', auto: (r) => -sum(r, ['WZG']) },
  { key: 'werkzeugGeld', label: 'Werkzeuggeld' }, { key: 'benzin', label: 'Benzinkosten-Zuschuss' },
  { key: 'reiseFrei', label: 'Reisekosten steuerfrei', auto: (r) => r.spesen },
  { key: 'reisePausch', label: 'Reisekosten pauschalversteuert' },
  { key: 'auslagen', label: 'Auslagenerstattung', auto: (r) => sum(r, ['AUSLAGEN']) },
];
export const KM: Col = { key: 'kmPauschale', label: 'Kilometerpauschale', auto: (r) => Math.round(r.km * 30) };
export const DAYS: Col[] = [
  { key: 'unbezahlt', label: 'unbezahlter Urlaub' }, { key: 'urlaub', label: 'Urlaub genommen' }, { key: 'krank', label: 'krank' }, { key: 'uebrig', label: 'Urlaub übrig' },
];
export const KEYS = [...GROSS, ...MONEY, KM, ...DAYS].map((c) => c.key);

export const value = (c: Col, r: Row, inp: Inputs) => (c.key in inp ? inp[c.key] : c.auto?.(r) ?? 0);
export const brutto = (r: Row, inp: Inputs) => GROSS.reduce((n, c) => n + value(c, r, inp), 0);
