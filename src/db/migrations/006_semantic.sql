CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('turn','user_msg','tool_result','session_summary')),
  source_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source_kind, source_id, position)
);
CREATE INDEX idx_chunks_session ON chunks(session_id);

CREATE TABLE embeddings (
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  PRIMARY KEY (chunk_id, model_name)
);

CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_turn_id TEXT,
  detected_at INTEGER NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','done','scheduled'))
);
CREATE INDEX idx_ideas_cluster ON ideas(cluster_id);
CREATE INDEX idx_ideas_status ON ideas(status);

CREATE TABLE claude_md_suggestions (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  body TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  detected_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed'))
);

CREATE TABLE prompt_lints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  message TEXT NOT NULL,
  similar_session_ids TEXT NOT NULL,
  detected_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed'))
);
CREATE INDEX idx_prompt_lints_session ON prompt_lints(session_id);
