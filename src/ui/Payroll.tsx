import { useCallback, useEffect, useState } from 'react';
import { api, eur, fromCents, toCents, type MonthView } from './api.ts';
import { GROSS, MONEY, KM, DAYS, brutto, value, type Inputs } from '../calc/payroll.ts';

type All = Record<string, Inputs>;
type Col = (typeof GROSS)[number];
const MONEY_COLS = [...MONEY, KM];
const cell = (v: string | number) => { const s = String(v); const q = /^[=+@]|^-(?!\d)/.test(s) ? "'" + s : s; return /[;"\n]/.test(q) ? '"' + q.replace(/"/g, '""') + '"' : q; };

export function PayrollPage({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const [view, setView] = useState<MonthView | null>(null);
  const [inputs, setInputs] = useState<All>({});
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setError(''); const [v, i] = await Promise.all([api<MonthView>(`/api/months/${month}`), api<All>(`/api/payroll/${month}`)]); setView(v); setInputs(i); }
    catch (e) { setError((e as Error).message); setView(null); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const rows = view?.result.rows.filter((r) => !r.weeks) || [];
  const frozen = !!view?.frozen;
  const put = async (resourceId: string, key: string, v: number | string | null) => {
    try { await api('/api/payroll', 'PUT', { month, resourceId, key, value: v }); await load(); } catch (e) { setError((e as Error).message); }
  };
  const notes = (inputs._notes || {}) as unknown as Record<string, string>;

  const csv = () => {
    const head = ['Mitarbeiter', ...GROSS.map((c) => c.label), 'Gesamt Brutto', ...MONEY_COLS.map((c) => c.label), 'Kilometer', ...DAYS.map((c) => c.label)];
    const out = [head.map(cell).join(';')];
    for (const r of rows) {
      const inp = inputs[r.resourceId] || {};
      const f = (c: Col) => fromCents(value(c, r, inp));
      out.push([r.name, ...GROSS.map(f), fromCents(brutto(r, inp)), ...MONEY_COLS.map(f), r.km.toFixed(0), ...DAYS.map((c) => String(value(c, r, inp)).replace('.', ','))].map(cell).join(';'));
    }
    out.push('', `Unbezahlter Urlaub;${cell(notes.unpaid || '')}`, `Krank;${cell(notes.sick || '')}`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + out.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
    a.download = `loehne-${month}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const money = (r: (typeof rows)[number], c: Col) => {
    const inp = inputs[r.resourceId] || {};
    const auto = c.auto?.(r) ?? 0;
    return <input aria-label={`${c.label} ${r.name}`} className="amt" inputMode="decimal" disabled={frozen} placeholder={auto ? fromCents(auto) : ''}
      key={r.resourceId + c.key + (inp[c.key] ?? 'auto')} defaultValue={c.key in inp ? fromCents(inp[c.key]) : ''}
      onBlur={(e) => { const t = e.target.value.trim(); const cents = t ? toCents(t) : null; if (t && cents === null) return; if (cents !== (c.key in inp ? inp[c.key] : null)) put(r.resourceId, c.key, cents); }} />;
  };
  const total = (c: Col) => rows.reduce((n, r) => n + value(c, r, inputs[r.resourceId] || {}), 0);

  return (
    <section>
      <h1>Lohnabrechnung für den Steuerberater</h1>
      <div className="toolbar">
        <label>Monat <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        {frozen && <span className="muted">Monat freigegeben, Eingaben gesperrt.</span>}
        <span className="muted">Graue Werte sind berechnet. Eintragen überschreibt sie, leeren stellt sie wieder her.</span>
        <span className="spacer" />
        <button onClick={csv} disabled={!rows.length}>Export CSV</button><button onClick={() => window.print()}>Drucken</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {view && (
        <div className="scroll">
          <table className="grid payroll" data-testid="payroll-table">
            <thead><tr>
              <th className="sticky">{month}</th>
              {GROSS.map((c) => <th key={c.key} className="num">{c.label}</th>)}<th className="num">Gesamt Brutto</th>
              {MONEY_COLS.map((c) => <th key={c.key} className="num">{c.label}</th>)}<th className="num">Kilometer</th>
              {DAYS.map((c) => <th key={c.key} className="num">{c.label}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const inp = inputs[r.resourceId] || {};
                return (
                  <tr key={r.resourceId}>
                    <th scope="row" className="sticky">{r.name}</th>
                    {GROSS.map((c) => <td key={c.key} className="num">{money(r, c)}</td>)}
                    <td className="num strong">{eur(brutto(r, inp))}</td>
                    {MONEY_COLS.map((c) => <td key={c.key} className="num">{money(r, c)}</td>)}
                    <td className="num">{r.km.toFixed(0)}</td>
                    {DAYS.map((c) => <td key={c.key} className="num"><input aria-label={`${c.label} ${r.name}`} className="amt day" inputMode="decimal" disabled={frozen} key={r.resourceId + c.key + (inp[c.key] ?? '')} defaultValue={c.key in inp ? String(inp[c.key]).replace('.', ',') : ''}
                      onBlur={(e) => { const t = e.target.value.trim().replace(',', '.'); const n = t ? Number(t) : null; if (n !== null && !Number.isFinite(n)) return; if (n !== (c.key in inp ? inp[c.key] : null)) put(r.resourceId, c.key, n); }} /></td>)}
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={20} className="muted">Keine Daten für diesen Monat.</td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr>
              <th className="sticky">Gesamt</th>
              {GROSS.map((c) => <td key={c.key} className="num">{eur(total(c))}</td>)}
              <td className="num strong">{eur(rows.reduce((n, r) => n + brutto(r, inputs[r.resourceId] || {}), 0))}</td>
              {MONEY_COLS.map((c) => <td key={c.key} className="num">{eur(total(c))}</td>)}
              <td className="num">{rows.reduce((n, r) => n + r.km, 0).toFixed(0)}</td><td colSpan={DAYS.length} />
            </tr></tfoot>}
          </table>
        </div>
      )}
      {view && (
        <div className="cols notes">
          {([['unpaid', 'Unbezahlter Urlaub'], ['sick', 'Krank']] as const).map(([k, label]) => (
            <label key={k} className="note">{label}
              <textarea rows={3} disabled={frozen} placeholder="z. B. L. Pede: 12. bis 22.10." key={k + (notes[k] ?? '')} defaultValue={notes[k] ?? ''} onBlur={(e) => { if (e.target.value !== (notes[k] ?? '')) put('_notes', k, e.target.value || null); }} />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
