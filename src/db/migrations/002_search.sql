ALTER TABLE sessions ADD COLUMN last_parsed_offset INTEGER NOT NULL DEFAULT 0;

CREATE VIRTUAL TABLE session_content_fts USING fts5(
  session_id UNINDEXED,
  content
);
