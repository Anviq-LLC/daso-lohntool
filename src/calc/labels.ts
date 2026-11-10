// Fixed Lohnart names, shared by table, detail and export so a free-text label never becomes a column title.
export const LABELS: Record<string, string> = {
  FIX: 'Festgehalt', LOHN: 'Stundenlohn', ZUS_NIGHT: 'Nachtzuschlag', ZUS_SUNDAY: 'Sonntagszuschlag', ZUS_HOLIDAY: 'Feiertagszuschlag',
  ABW: 'Urlaub, Krank, Feiertag', ANF: 'Anfahrt Obermonteur', UMS: 'Umsatzbonus', SAM: 'Samstagsbonus', NU: 'NU-Bonus',
  KORREKTUR: 'Bonuskorrektur', PRAEMIE: 'Prämie', AUSLAGEN: 'Auslagenerstattung', NOTFALL: 'Notfall-Unterstützung', SONSTIGES: 'Sonstiges',
  VORTRAG: 'Übertrag Vormonat', WZG: 'Werkzeugrate', SALDO: 'Ausgleich negativer Bonus',
};
export const ORDER = Object.keys(LABELS);
export const sortCodes = (codes: Iterable<string>) => [...new Set(codes)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
export const de = (n: number, digits = 2) => n.toFixed(digits).replace('.', ',');
export const deEur = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
