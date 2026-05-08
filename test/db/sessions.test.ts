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
    last_parsed_offset: 0,
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

  it("getFileStat returns null for a missing id", () => {
    expect(repo.getFileStat("missing")).toBeNull();
  });

  it("getFileStat returns mtime and size for a present session", () => {
    repo.upsert(makeRow({ file_mtime: 1700000123456, file_size: 4096 }));
    expect(repo.getFileStat("abc-123")).toEqual({
      mtime: 1700000123456,
      size: 4096,
    });
  });

  it("listAllNonArchived returns only non-archived sessions ordered by last_active_at desc", () => {
    repo.upsert(makeRow({ id: "a", last_active_at: 1, archived: 0 }));
    repo.upsert(makeRow({ id: "b", last_active_at: 3, archived: 1 }));
    repo.upsert(makeRow({ id: "c", last_active_at: 2, archived: 0 }));
    const got = repo.listAllNonArchived().map((s) => s.id);
    expect(got).toEqual(["c", "a"]);
  });

  it("listByProjectNonArchived filters by project_path AND non-archived", () => {
    repo.upsert(makeRow({ id: "a", project_path: "/p1", archived: 0 }));
    repo.upsert(makeRow({ id: "b", project_path: "/p1", archived: 1 }));
    repo.upsert(makeRow({ id: "c", project_path: "/p2", archived: 0 }));
    const got = repo.listByProjectNonArchived("/p1").map((s) => s.id);
    expect(got).toEqual(["a"]);
  });

  it("setCustomTitle updates the column", () => {
    repo.upsert(makeRow());
    repo.setCustomTitle("abc-123", "My Title");
    expect(repo.findById("abc-123")?.custom_title).toBe("My Title");
    repo.setCustomTitle("abc-123", null);
    expect(repo.findById("abc-123")?.custom_title).toBeNull();
  });

  it("setCategory updates the column", () => {
    repo.upsert(makeRow());
    const catId = Number(
      db
        .prepare(
          "INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)",
        )
        .run("work", null, 0).lastInsertRowid,
    );
    repo.setCategory("abc-123", catId);
    expect(repo.findById("abc-123")?.category_id).toBe(catId);
    repo.setCategory("abc-123", null);
    expect(repo.findById("abc-123")?.category_id).toBeNull();
  });

  it("setNotes updates the column", () => {
    repo.upsert(makeRow());
    repo.setNotes("abc-123", "hello");
    expect(repo.findById("abc-123")?.notes).toBe("hello");
  });

  it("setFavorited and setArchived toggle 0/1", () => {
    repo.upsert(makeRow());
    repo.setFavorited("abc-123", true);
    expect(repo.findById("abc-123")?.favorited).toBe(1);
    repo.setFavorited("abc-123", false);
    expect(repo.findById("abc-123")?.favorited).toBe(0);
    repo.setArchived("abc-123", true);
    expect(repo.findById("abc-123")?.archived).toBe(1);
  });

  it("user fields are preserved across re-upsert", () => {
    repo.upsert(makeRow());
    repo.setCustomTitle("abc-123", "Pinned");
    repo.setFavorited("abc-123", true);
    repo.upsert(makeRow({ auto_title: "rescanned" }));
    const found = repo.findById("abc-123");
    expect(found?.custom_title).toBe("Pinned");
    expect(found?.favorited).toBe(1);
    expect(found?.auto_title).toBe("rescanned");
  });
});
