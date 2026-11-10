CREATE TABLE resources (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Monteur', sort_order INTEGER NOT NULL DEFAULT 0, archived_at TEXT);
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, foreman_id TEXT, archived_at TEXT);
CREATE TABLE assignments (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, project_id TEXT, day TEXT NOT NULL, assignment_type TEXT NOT NULL DEFAULT 'project');
CREATE TABLE punches (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, project_id TEXT, started TEXT NOT NULL, ended TEXT, pause INTEGER);
CREATE TABLE day_entries (resource_id TEXT NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (resource_id, day));
