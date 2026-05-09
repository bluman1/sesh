import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { TurnRepository, type TurnRow } from "../../src/db/turns";

function makeTurn(overrides: Partial<TurnRow> = {}): TurnRow {
  return {
    id: "u1",
    session_id: "s1",
    seq: 0,
    role: "user",
    model: null,
    ts: 1700000000000,
    tokens_in: 0,
    tokens_out: 0,
    tokens_cache_read: 0,
    tokens_cache_create: 0,
    text_len: 12,
    latency_ms: null,
    is_correction: 0,
    ...overrides,
  };
}

describe("TurnRepository", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let repo: TurnRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    repo = new TurnRepository(db);
    sessionRepo.upsert({
      id: "s1",
      source: "claude-code",
      project_path: "/p",
      file_path: "/p/s1.jsonl",
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
    });
  });

  it("upsertMany inserts and is idempotent", () => {
    repo.upsertMany([makeTurn({ id: "u1" }), makeTurn({ id: "a1", role: "assistant", model: "claude-opus-4-7", seq: 1 })]);
    repo.upsertMany([makeTurn({ id: "u1", text_len: 99 })]);
    const turns = repo.listBySession("s1");
    expect(turns.length).toBe(2);
    expect(turns.find((t) => t.id === "u1")?.text_len).toBe(99);
  });

  it("listBySession orders by seq ascending", () => {
    repo.upsertMany([
      makeTurn({ id: "c", seq: 2 }),
      makeTurn({ id: "a", seq: 0 }),
      makeTurn({ id: "b", seq: 1 }),
    ]);
    expect(repo.listBySession("s1").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("deleteBySession cascades", () => {
    repo.upsertMany([makeTurn({ id: "u1" })]);
    repo.deleteBySession("s1");
    expect(repo.listBySession("s1")).toEqual([]);
  });

  it("listByModel filters and excludes nulls", () => {
    repo.upsertMany([
      makeTurn({ id: "u1", role: "user", model: null }),
      makeTurn({ id: "a1", role: "assistant", model: "claude-opus-4-7", seq: 1 }),
      makeTurn({ id: "a2", role: "assistant", model: "claude-haiku-4-5", seq: 2 }),
    ]);
    expect(repo.listByModel("claude-opus-4-7").map((t) => t.id)).toEqual(["a1"]);
  });
});
