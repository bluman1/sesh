-- Per-turn analytics: turns, tool_calls, outcomes.
-- Foundation for cost dashboards, model leaderboard, personal records,
-- daily standup, commitments tracking, next-session suggester.

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  model TEXT,
  ts INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER NOT NULL DEFAULT 0,
  tokens_cache_create INTEGER NOT NULL DEFAULT 0,
  text_len INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  is_correction INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_turns_session_seq ON turns(session_id, seq);
CREATE INDEX idx_turns_model ON turns(model);
CREATE INDEX idx_turns_ts ON turns(ts);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_path TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  result_size INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX idx_tool_calls_name ON tool_calls(name);
CREATE INDEX idx_tool_calls_target ON tool_calls(target_path);

CREATE TABLE session_outcomes (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('open', 'shipped', 'shipped-partial', 'reverted', 'abandoned')),
  state_inferred_at INTEGER NOT NULL,
  user_marked INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX idx_session_outcomes_state ON session_outcomes(state);

ALTER TABLE sessions ADD COLUMN turns_indexed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN turns_last_offset INTEGER NOT NULL DEFAULT 0;
