import { describe, it, expect, beforeEach } from "vitest";
import * as path from "node:path";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { ContentIndexer } from "../../src/scanner/contentIndexer";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample.jsonl");

describe("ContentIndexer", () => {
  let db: Db;
  let repo: SessionRepository;
  let indexer: ContentIndexer;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    repo = new SessionRepository(db);
    indexer = new ContentIndexer(db, repo);
    repo.upsert({
      id: "sample-id",
      source: "claude-code",
      project_path: "/p",
      file_path: SAMPLE,
      file_mtime: 0,
      file_size: 0,
      created_at: 0,
      last_active_at: 0,
      message_count: 0,
      auto_title: null,
      custom_title: null,
      category_id: null,
      notes: null,
      favorited: 0,
      archived: 0,
      orphaned: 0,
      content_indexed: 0,
      last_parsed_offset: 0,
      tokens_in: 0,
      tokens_out: 0,
      tokens_cache_read: 0,
      tokens_cache_create: 0,
      turns_indexed: 0,
      turns_last_offset: 0,
      repo_path: null,
    });
  });

  it("populates FTS and marks content_indexed", async () => {
    await indexer.run();
    expect(repo.findById("sample-id")?.content_indexed).toBe(1);
    const found = db
      .prepare(
        "SELECT content FROM session_content_fts WHERE session_id = ? AND content MATCH 'first OR prompt'",
      )
      .all("sample-id");
    expect(found.length).toBeGreaterThan(0);
  });

  it("reports progress", async () => {
    const events: { d: number; t: number }[] = [];
    indexer.setProgressHandler((d, t) => events.push({ d, t }));
    await indexer.run();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]).toEqual({ d: 1, t: 1 });
  });
});
