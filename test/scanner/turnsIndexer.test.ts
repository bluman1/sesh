import { describe, it, expect, beforeEach } from "vitest";
import * as path from "node:path";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { TurnRepository } from "../../src/db/turns";
import { ToolCallRepository } from "../../src/db/toolCalls";
import { TurnsIndexer } from "../../src/scanner/turnsIndexer";

const FIXTURE = path.join(__dirname, "..", "fixtures", "turns-sample.jsonl");

describe("TurnsIndexer", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let turns: TurnRepository;
  let toolCalls: ToolCallRepository;
  let indexer: TurnsIndexer;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    turns = new TurnRepository(db);
    toolCalls = new ToolCallRepository(db);
    indexer = new TurnsIndexer(db, sessionRepo, turns, toolCalls);
    sessionRepo.upsert({
      id: "s-fixture",
      source: "claude-code",
      project_path: "/tmp/proj",
      file_path: FIXTURE,
      file_mtime: 0, file_size: 0, created_at: 0, last_active_at: 0, message_count: 0,
      auto_title: null, custom_title: null, category_id: null, notes: null,
      favorited: 0, archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
      turns_indexed: 0, turns_last_offset: 0, repo_path: null,
    });
  });

  it("populates turns and tool_calls and marks turns_indexed=1", async () => {
    await indexer.run();
    expect(turns.countBySession("s-fixture")).toBe(4);
    expect(toolCalls.listBySession("s-fixture").length).toBe(1);
    expect(sessionRepo.findById("s-fixture")?.turns_indexed).toBe(1);
  });

  it("reports progress", async () => {
    const events: { d: number; t: number }[] = [];
    indexer.setProgressHandler((d, t) => events.push({ d, t }));
    await indexer.run();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]).toEqual({ d: 1, t: 1 });
  });

  it("skips orphaned sessions", async () => {
    sessionRepo.markOrphaned("s-fixture");
    await indexer.run();
    expect(turns.countBySession("s-fixture")).toBe(0);
  });

  it("re-running is idempotent (already-indexed sessions are skipped)", async () => {
    await indexer.run();
    const firstCount = turns.countBySession("s-fixture");
    await indexer.run();
    expect(turns.countBySession("s-fixture")).toBe(firstCount);
  });

  it("indexOne can be called directly and refreshes turns", async () => {
    await indexer.indexOne("s-fixture", FIXTURE, "claude-code");
    expect(turns.countBySession("s-fixture")).toBe(4);
  });

  it("cancel() stops a running indexer", async () => {
    const promise = indexer.run();
    indexer.cancel();
    await promise;
    // Cancellation should not throw.
  });
});
