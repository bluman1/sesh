-- Git-link substrate: maps sessions ↔ commits via cwd + timestamp + file overlap.
-- Foundation for Reviewer tab, PR companion, auto-shipped/auto-reverted
-- outcome inference.

CREATE TABLE commits (
  sha TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  branch TEXT,
  authored_at INTEGER NOT NULL,
  author TEXT,
  message TEXT
);
CREATE INDEX idx_commits_repo ON commits(repo_path);
CREATE INDEX idx_commits_authored ON commits(authored_at);

CREATE TABLE commit_files (
  sha TEXT NOT NULL REFERENCES commits(sha) ON DELETE CASCADE,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sha, path)
);
CREATE INDEX idx_commit_files_path ON commit_files(path);

CREATE TABLE session_commits (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL REFERENCES commits(sha) ON DELETE CASCADE,
  confidence REAL NOT NULL,
  PRIMARY KEY (session_id, commit_sha)
);
CREATE INDEX idx_session_commits_sha ON session_commits(commit_sha);

ALTER TABLE sessions ADD COLUMN repo_path TEXT;
