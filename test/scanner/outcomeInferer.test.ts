import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { OutcomeRepository } from "../../src/db/outcomes";
import { inferOutcomes } from "../../src/scanner/outcomeInferer";

describe("inferOutcomes", () => {
  let db: Db;
  let sessions: SessionRepository;
  let outcomes: OutcomeRepository;
  const NOW = 1700000000000;
  const DAY = 86400 * 1000;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessions = new SessionRepository(db);
    outcomes = new OutcomeRepository(db);
  });

  function fakeSession(id: string, lastActive: number) {
    sessions.upsert({
      id, source: "claude-code", project_path: "/p", file_path: `/p/${id}.jsonl`,
      file_mtime: 0, file_size: 0, created_at: lastActive - 1000, last_active_at: lastActive,
      message_count: 1,
      auto_title: null, custom_title: null, category_id: null, notes: null,
      favorited: 0, archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
      turns_indexed: 0, turns_last_offset: 0,
    });
  }

  it("flags >30d inactive sessions as 'abandoned'", () => {
    fakeSession("s-old", NOW - 31 * DAY);
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-old")?.state).toBe("abandoned");
  });

  it("flags <30d inactive sessions as 'open'", () => {
    fakeSession("s-fresh", NOW - 5 * DAY);
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-fresh")?.state).toBe("open");
  });

  it("does not overwrite user-marked outcomes", () => {
    fakeSession("s-pinned", NOW - 60 * DAY);
    outcomes.setUser("s-pinned", "shipped", "I shipped this manually");
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-pinned")?.state).toBe("shipped");
  });

  it("respects custom windowDays", () => {
    fakeSession("s-week", NOW - 8 * DAY);
    inferOutcomes({ db, now: NOW, windowDays: 7 });
    expect(outcomes.getForSession("s-week")?.state).toBe("abandoned");
  });
});
