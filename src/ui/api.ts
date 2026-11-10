import type { MonthResult } from '../calc/month.ts';

export type MonthView = {
  result: MonthResult; unchecked: { day: string; project: string }[]; status: string; frozen: boolean; releasedBy?: string; releasedAt?: string;
};

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Fehler ${res.status}`);
  return data as T;
}

export const eur = (c: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100);
// "1.234,56" or "12,5" -> cents; empty or invalid -> null
export function toCents(s: string): number | null {
  const t = s.trim().replace(/\s|€/g, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
export const fromCents = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
export const hours = (min: number) => (min / 60).toFixed(2).replace('.', ',');
