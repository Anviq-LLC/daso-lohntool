import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, eur, hours, toCents, type MonthView } from './api.ts';
import { LABELS, sortCodes } from '../calc/labels.ts';

const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const STATUS: Record<string, string> = { offen: 'In Berechnung', pruefung: 'Prüfung offen', freigabe: 'Zur Freigabe', freigegeben: 'Freigegeben', abgeschlossen: 'Abgeschlossen' };
const NEXT: Record<string, [string, string] | undefined> = {
  offen: ['pruefung', 'Zur Prüfung geben'], pruefung: ['freigabe', 'Zur Freigabe geben'], freigabe: ['freigegeben', 'Freigeben'], freigegeben: ['abgeschlossen', 'Abschließen'],
};

export function MonthPage({ month, setMonth, role }: { month: string; setMonth: (m: string) => void; role: string }) {
  const [view, setView] = useState<MonthView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setView(await api<MonthView>(`/api/months/${month}`)); } catch (e) { setError((e as Error).message); setView(null); } finally { setBusy(false); }
  }, [month]);
  useEffect(() => { setOpen(null); load(); }, [load]);

  const move = async (to: string, extra: object = {}) => {
    try { await api(`/api/months/${month}/status`, 'POST', { to, ...extra }); await load(); } catch (e) { setError((e as Error).message); }
  };
  const [reopenReason, setReopenReason] = useState<string | null>(null);

  const codes = view ? sortCodes(view.result.rows.flatMap((r) => r.lines.map((l) => l.code))).map((c) => [c, LABELS[c] ?? c] as const) : [];
  const sel = view?.result.rows.find((r) => r.resourceId === open);
  const subs = view?.result.rows.filter((r) => r.weeks) || [];
  const next = view ? NEXT[view.status] : undefined;

  return (
    <section>
      <div className="toolbar">
        <label>Monat <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        {view && <span className={`chip s-${view.status}`} data-testid="status">{STATUS[view.status]}</span>}
        {view?.frozen && <span className="muted">Schreibgeschützt, freigegeben von {view.releasedBy}</span>}
        <span className="spacer" />
        {view && next && <button className="primary" onClick={() => move(next[0])}>{next[1]}</button>}
        {view?.status === 'freigegeben' && role === 'gf' && reopenReason === null && <button onClick={() => setReopenReason('')}>Freigabe zurücknehmen</button>}
        {view?.status === 'freigegeben' && role === 'gf' && reopenReason !== null && (
          <form className="inline" aria-label="Freigabe zurücknehmen" onSubmit={(e) => { e.preventDefault(); move('pruefung', { reason: reopenReason }); setReopenReason(null); }}>
            <input required autoFocus placeholder="Grund" aria-label="Grund" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
            <button className="primary">Zurücknehmen</button><button type="button" onClick={() => setReopenReason(null)}>Abbrechen</button>
          </form>
        )}
        {view && (view.status === 'freigegeben' || view.status === 'abgeschlossen') && <a className="btn" href={`/api/months/${month}/export.csv`}>Export CSV</a>}
        <button onClick={() => window.print()}>Drucken</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {busy && <p className="muted">Berechne ...</p>}
      {view && (
        <>
          <div className="scroll">
            <table className="grid" data-testid="month-table">
              <thead>
                <tr>
                  <th className="sticky">Mitarbeiter</th><th className="num">Stunden</th><th className="num">Umsatz</th>
                  {codes.map(([c, l]) => <th key={c} className="num">{l}</th>)}
                  <th className="num">Summe</th><th className="num">Spesen (steuerfrei)</th><th className="num">km</th><th>Hinweise</th>
                </tr>
              </thead>
              <tbody>
                {view.result.rows.map((r) => (
                  <tr key={r.resourceId} className={open === r.resourceId ? 'on' : ''} onClick={() => setOpen(open === r.resourceId ? null : r.resourceId)}>
                    <th className="sticky" scope="row"><button className="link" aria-expanded={open === r.resourceId}>{r.name}</button></th>
                    <td className="num">{hours(r.metrics.workMinutes)}</td>
                    <td className="num">{eur(r.metrics.revenue)}</td>
                    {codes.map(([c]) => { const v = r.lines.filter((l) => l.code === c).reduce((n, l) => n + l.cents, 0); return <td key={c} className={'num' + (v < 0 ? ' neg' : '')}>{r.lines.some((l) => l.code === c) ? eur(v) : ''}</td>; })}
                    <td className="num strong">{eur(r.payout)}</td>
                    <td className="num">{eur(r.spesen)}</td>
                    <td className="num">{r.km.toFixed(0)}</td>
                    <td>{r.warnings.length ? <span className="badge" title={r.warnings.join('\n')}>{r.warnings.length}</span> : ''}</td>
                  </tr>
                ))}
                {!view.result.rows.length && <tr><td colSpan={codes.length + 7} className="muted">Keine Daten für diesen Monat.</td></tr>}
              </tbody>
              {view.result.rows.length > 0 && (
                <tfoot><tr>
                  <th className="sticky">Gesamt</th><td className="num">{hours(view.result.rows.reduce((n, r) => n + r.metrics.workMinutes, 0))}</td>
                  <td className="num">{eur(view.result.rows.reduce((n, r) => n + r.metrics.revenue, 0))}</td>
                  {codes.map(([c]) => <td key={c} className="num">{eur(view.result.rows.reduce((n, r) => n + r.lines.filter((l) => l.code === c).reduce((a, l) => a + l.cents, 0), 0))}</td>)}
                  <td className="num strong">{eur(view.result.rows.reduce((n, r) => n + r.payout, 0))}</td>
                  <td className="num">{eur(view.result.rows.reduce((n, r) => n + r.spesen, 0))}</td><td className="num">{view.result.rows.reduce((n, r) => n + r.km, 0).toFixed(0)}</td><td />
                </tr></tfoot>
              )}
            </table>
          </div>
          {subs.length > 0 && (
            <section className="sub">
              <h2>SUB Wochenauswertung</h2>
              <div className="scroll"><table>
                <thead><tr><th>Mitarbeiter</th><th>Woche</th><th className="num">Stunden</th><th className="num">Anfahrt</th><th className="num">Kosten</th></tr></thead>
                <tbody>{subs.map((r) => (
                  <Fragment key={r.resourceId}>
                    {r.weeks!.map((w) => <tr key={w.kw}><td>{r.name}</td><td>{w.kw}</td><td className="num">{hours(w.workMinutes)}</td><td className="num">{hours(w.travelMinutes)}</td><td className="num">{eur(w.cents)}</td></tr>)}
                    <tr className="strong"><td colSpan={4}>Summe {r.name}</td><td className="num">{eur(r.payout)}</td></tr>
                  </Fragment>
                ))}</tbody>
              </table></div>
            </section>
          )}
          {sel && (
            <aside className="detail" aria-label={`Details ${sel.name}`}>
              <h2>{sel.name}</h2>
              <table>
                <tbody>
                  {sel.lines.map((l, i) => <tr key={i}><td>{l.label}</td><td className="muted">{l.note}</td><td className="num">{eur(l.cents)}</td></tr>)}
                  <tr className="strong"><td colSpan={2}>Summe</td><td className="num">{eur(sel.payout)}</td></tr>
                </tbody>
              </table>
              {sel.calendar && (
                <>
                  <h3>Monatsansicht</h3>
                  <table className="cal" aria-label={`Monatsansicht ${sel.name}`}>
                    <thead><tr><th>Tag</th><th className="num">Stunden</th><th>Status</th><th>Projekt und Umsatz</th><th className="num">Umsatz</th></tr></thead>
                    <tbody>
                      {sel.calendar.filter((d) => d.workMinutes || d.revenue.length || d.absence || d.flag).map((d) => (
                        <tr key={d.day} className={d.flag} title={d.note}>
                          <td>{WEEKDAY[new Date(d.day + 'T00:00:00Z').getUTCDay()]} {d.day.slice(8)}.{d.day.slice(5, 7)}.</td>
                          <td className="num">{d.workMinutes ? hours(d.workMinutes) : ''}</td>
                          <td>{d.absence || d.note}</td>
                          <td>{d.revenue.map((r) => r.label).join(', ')}</td>
                          <td className="num">{d.revenue.length ? eur(d.revenue.reduce((n, r) => n + r.cents, 0)) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td>Summe</td><td className="num">{hours(sel.calendar.reduce((n, d) => n + d.workMinutes, 0))}</td><td colSpan={2} /><td className="num">{eur(sel.calendar.reduce((n, d) => n + d.revenue.reduce((a, r) => a + r.cents, 0), 0))}</td></tr></tfoot>
                  </table>
                </>
              )}
              <p className="muted">Umsatzbasis {eur(sel.metrics.revenue)} (davon Ersatzumsatz {eur(sel.metrics.replacement)}, Samstag {eur(sel.metrics.saturdayRevenue)}) · {sel.metrics.absentDays} Abwesenheitstage</p>
              {sel.warnings.length > 0 && <ul className="warnlist">{sel.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              {!view.frozen && <AdjustForm month={month} resourceId={sel.resourceId} onDone={load} />}
            </aside>
          )}
          {view.result.nu.length > 0 && <NuTable month={month} view={view} onDone={load} frozen={view.frozen} />}
        </>
      )}
    </section>
  );
}

function AdjustForm({ month, resourceId, onDone }: { month: string; resourceId: string; onDone: () => void }) {
  const [kind, setKind] = useState('korrektur');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = toCents(amount);
    if (cents === null) return setErr('Betrag fehlt.');
    try { await api('/api/adjustments', 'POST', { month, resourceId, kind, label, cents }); setLabel(''); setAmount(''); setErr(''); onDone(); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <form onSubmit={submit} className="inline" aria-label="Korrektur erfassen">
      <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Lohnart">
        <option value="korrektur">Bonuskorrektur</option><option value="praemie">Prämie</option><option value="auslagen">Auslagenerstattung</option>
        <option value="notfall">Notfall-Unterstützung</option><option value="sonstiges">Sonstiges</option>
      </select>
      <input placeholder="Bezeichnung" value={label} onChange={(e) => setLabel(e.target.value)} required aria-label="Bezeichnung" />
      <input placeholder="Betrag, z. B. -50,00" value={amount} onChange={(e) => setAmount(e.target.value)} required aria-label="Betrag" inputMode="decimal" />
      <button className="primary">Erfassen</button>
      {err && <span role="alert" className="error">{err}</span>}
    </form>
  );
}

function NuTable({ month, view, onDone, frozen }: { month: string; view: MonthView; onDone: () => void; frozen: boolean }) {
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api<{ id: string; name: string }[]>('/api/terms').then(setPeople).catch(() => {}); }, []);
  const save = async (projectId: string) => {
    const c = toCents(costs[projectId] || '');
    if (c !== null) { await api('/api/nu-costs', 'PUT', { month, projectId, cents: c }); onDone(); }
  };
  const assign = async (n: MonthView['result']['nu'][number], patch: Partial<{ firstId: string | null; secondId: string | null; secondPct: number }>) => {
    const next = { firstId: n.firstId, secondId: n.secondId, secondPct: n.secondPct, ...patch };
    if (!next.secondId) next.secondPct = 0;
    await api('/api/nu-assign', 'PUT', { month, projectId: n.projectId, ...next });
    onDone();
  };
  const pick = (label: string, value: string | null, onChange: (v: string | null) => void, none: string) => (
    <select aria-label={label} disabled={frozen} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{none}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
  return (
    <section className="nu">
      <h2>Nachunternehmer-Projekte</h2>
      <div className="scroll"><table>
        <thead><tr><th>Projekt</th><th className="num">Umsatz</th><th className="num">NU-Kosten</th>{!frozen && <th>Sonstige Kosten</th>}<th className="num">Gewinn / Verlust</th><th className="num">Bonus 10 %</th><th>Bonus an</th><th>2. Mitarbeiter</th><th className="num">Anteil 2. MA %</th></tr></thead>
        <tbody>
          {view.result.nu.map((n) => (
            <tr key={n.projectId}>
              <td>{n.projectName}</td><td className="num">{eur(n.revenue)}</td><td className="num">{n.cost === null ? 'unvollständig' : eur(n.cost)}</td>
              {!frozen && <td><input aria-label={`Sonstige Kosten ${n.projectName}`} inputMode="decimal" value={costs[n.projectId] ?? ''} onChange={(e) => setCosts({ ...costs, [n.projectId]: e.target.value })} onBlur={() => save(n.projectId)} /></td>}
              <td className={'num' + ((n.profit ?? 0) < 0 ? ' neg' : '')}>{n.profit === null ? '-' : eur(n.profit)}</td><td className="num">{eur(n.bonus)}</td>
              <td>{pick(`Bonus an ${n.projectName}`, n.firstId, (v) => assign(n, { firstId: v }), 'Niemand')}</td>
              <td>{pick(`2. Mitarbeiter ${n.projectName}`, n.secondId, (v) => assign(n, { secondId: v }), 'Keiner')}</td>
              <td className="num"><input aria-label={`Anteil ${n.projectName}`} inputMode="numeric" disabled={frozen || !n.secondId} defaultValue={n.secondPct} key={n.projectId + n.secondPct} onBlur={(e) => { const v = Math.round(Number(e.target.value)); if (v >= 0 && v <= 100 && v !== n.secondPct) assign(n, { secondPct: v }); }} style={{ width: 70 }} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}
