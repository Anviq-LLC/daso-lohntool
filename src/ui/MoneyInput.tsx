import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { fromCents, toCents } from './api.ts';

// Keeps what is typed as text and converts only on blur, so "15," and "15,5" can be entered.
export function MoneyInput({ cents, onCommit, ...rest }: { cents: number | null; onCommit: (c: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [t, setT] = useState(fromCents(cents));
  useEffect(() => setT(fromCents(cents)), [cents]);
  return <input {...rest} inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)} onBlur={() => { const c = t.trim() ? toCents(t) : null; onCommit(c); setT(fromCents(c)); }} />;
}
