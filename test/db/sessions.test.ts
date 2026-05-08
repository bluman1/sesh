import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository, type SessionRow } from "../../src/db/sessions";

function makeRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "abc-123",
    source: "claude-code",
    project_path: "/Users/m/proj",
    file_path: "/Users/m/.claude/projects/-Users-m-proj/abc-123.jsonl",
    file_mtime: 1700000000000,
    file_size: 1024,
    created_at: 1700000000000,
    last_active_at: 1700000060000,
    message_count: 4,
    auto_title: "First prompt",
    custom_title: null,
    category_id: null,
    notes: null,
    favorited: 0,
    archived: 0,
    orphaned: 0,
    content_indexed: 0,
    ...overrides,
  };
}

describe("SessionRepository", () => {
  let db: Db;
  let repo: SessionRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    repo = new SessionRepository(db);
  });

  it("upserts and retrieves a session by id", () => {
    repo.upsert(makeRow());
    const found = repo.findById("abc-123");
    expect(found?.auto_title).toBe("First prompt");
  });

  it("upsert is idempotent — second call updates instead of erroring", () => {
    repo.upsert(makeRow());
    repo.upsert(makeRow({ auto_title: "Updated" }));
    expect(repo.findById("abc-123")?.auto_title).toBe("Updated");
  });

  it("listByProject filters by project_path and orders by last_active_at desc", () => {
    repo.upsert(makeRow({ id: "a", last_active_at: 1, project_path: "/p1" }));
    repo.upsert(makeRow({ id: "b", last_active_at: 3, project_path: "/p1" }));
    repo.upsert(makeRow({ id: "c", last_active_at: 2, project_path: "/p2" }));
    const got = repo.listByProject("/p1").map((s) => s.id);
    expect(got).toEqual(["b", "a"]);
  });

  it("returns null for a missing id", () => {
    expect(repo.findById("missing")).toBeNull();
  });
});
