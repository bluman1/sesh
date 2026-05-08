CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  project_path TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_mtime INTEGER NOT NULL,
  file_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  auto_title TEXT,
  custom_title TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  notes TEXT,
  favorited INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  orphaned INTEGER NOT NULL DEFAULT 0,
  content_indexed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sessions_project_active ON sessions(project_path, last_active_at DESC);
CREATE INDEX idx_sessions_category ON sessions(category_id);

CREATE TABLE tags (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (session_id, tag)
);
CREATE INDEX idx_tags_tag ON tags(tag);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE project_remap (
  from_path TEXT PRIMARY KEY,
  to_path TEXT NOT NULL
);

CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
