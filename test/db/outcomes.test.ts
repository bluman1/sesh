import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { OutcomeRepository, type OutcomeState } from "../../src/db/outcomes";

describe("OutcomeRepository", () => {
  let db: Db;
  let outcomes: OutcomeRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    const sessions = new SessionRepository(db);
    sessions.upsert({
      id: "s1", source: "claude-code", project_path: "/p", file_path: "/p/s1.jsonl",
      file_mtime: 0, file_size: 0, created_at: 0, last_active_at: 0, message_count: 0,
      auto_title: null, custom_title: null, category_id: null, notes: null,
      favorited: 0, archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
      turns_indexed: 0, turns_last_offset: 0, repo_path: null,
    });
    outcomes = new OutcomeRepository(db);
  });

  it("setInferred upserts an inferred state", () => {
    outcomes.setInferred("s1", "open");
    const o = outcomes.getForSession("s1")!;
    expect(o.state).toBe("open");
    expect(o.user_marked).toBe(0);
  });

  it("setUser overrides inferred and marks user_marked=1", () => {
    outcomes.setInferred("s1", "abandoned");
    outcomes.setUser("s1", "shipped", "manually shipped");
    const o = outcomes.getForSession("s1")!;
    expect(o.state).toBe("shipped");
    expect(o.user_marked).toBe(1);
    expect(o.notes).toBe("manually shipped");
  });

  it("setInferred does NOT overwrite a user-marked outcome", () => {
    outcomes.setUser("s1", "shipped", null);
    outcomes.setInferred("s1", "abandoned");
    expect(outcomes.getForSession("s1")?.state).toBe("shipped");
  });

  it("getForSession returns null when no row", () => {
    expect(outcomes.getForSession("s1")).toBeNull();
  });

  it("listByState filters by outcome state", () => {
    outcomes.setInferred("s1", "abandoned");
    expect(outcomes.listByState("abandoned").length).toBe(1);
    expect(outcomes.listByState("shipped").length).toBe(0);
  });

  const states: OutcomeState[] = ["open", "shipped", "shipped-partial", "reverted", "abandoned"];
  for (const s of states) {
    it(`accepts state '${s}'`, () => {
      outcomes.setInferred("s1", s);
      expect(outcomes.getForSession("s1")?.state).toBe(s);
    });
  }
});
