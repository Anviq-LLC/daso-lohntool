import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.ts';
import { MonthPage } from './MonthPage.tsx';
import { EmployeesPage, SettingsPage, ToolsPage, AuditPage } from './Pages.tsx';
import './style.css';

const TABS = [['month', 'Monat'], ['employees', 'Mitarbeiter'], ['tools', 'Werkzeug und Extern'], ['settings', 'Einstellungen'], ['audit', 'Protokoll']] as const;
type Tab = (typeof TABS)[number][0];

function App() {
  const [me, setMe] = useState<{ email: string; role: string } | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('month');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  useEffect(() => { api<{ email: string; role: string }>('/api/me').then(setMe).catch((e) => setError(e.message)); }, []);
  if (error) return <main className="center"><h1>Kein Zugang</h1><p role="alert">{error}</p></main>;
  if (!me) return <main className="center"><p>Lade ...</p></main>;
  return (
    <>
      <header className="bar">
        <strong>DaSO Lohntool</strong>
        <nav aria-label="Bereiche">
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? 'tab on' : 'tab'} aria-current={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </nav>
        <span className="who">{me.email} · {me.role === 'gf' ? 'Geschäftsführung' : 'Buchhaltung'}</span>
      </header>
      <main>
        {tab === 'month' && <MonthPage month={month} setMonth={setMonth} role={me.role} />}
        {tab === 'employees' && <EmployeesPage month={month} />}
        {tab === 'tools' && <ToolsPage month={month} setMonth={setMonth} />}
        {tab === 'settings' && <SettingsPage role={me.role} />}
        {tab === 'audit' && <AuditPage />}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
