CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE roles (email TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('buchhaltung','gf')), name TEXT NOT NULL DEFAULT '');
CREATE TABLE employee_terms (
  resource_id TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (resource_id, valid_from)
);
CREATE TABLE adjustments (
  id TEXT PRIMARY KEY, month TEXT NOT NULL, resource_id TEXT NOT NULL, kind TEXT NOT NULL,
  label TEXT NOT NULL, cents INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX adjustments_month ON adjustments(month);
CREATE TABLE tool_accounts (
  resource_id TEXT PRIMARY KEY, price_cents INTEGER NOT NULL, monthly_rate_cents INTEGER NOT NULL,
  paid_before_cents INTEGER NOT NULL DEFAULT 0, prepaid_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE external_weeks (
  id TEXT PRIMARY KEY, month TEXT NOT NULL, kw TEXT NOT NULL, label TEXT NOT NULL,
  minutes INTEGER NOT NULL, invoiced_cents INTEGER NOT NULL, rate_cents INTEGER NOT NULL DEFAULT 4000
);
CREATE INDEX external_month ON external_weeks(month);
CREATE TABLE nu_costs (project_id TEXT NOT NULL, month TEXT NOT NULL, cents INTEGER NOT NULL, PRIMARY KEY (project_id, month));
CREATE TABLE months (
  month TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'offen',
  snapshot TEXT, released_by TEXT, released_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE audit (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
CREATE INDEX audit_at ON audit(at);
