CREATE TABLE nu_assign (
  project_id TEXT NOT NULL, month TEXT NOT NULL, first_id TEXT, second_id TEXT, second_pct INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, month)
);
