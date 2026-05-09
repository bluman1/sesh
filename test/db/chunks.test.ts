import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { ChunkRepository, type ChunkRow } from "../../src/db/chunks";

function makeSession(id = "s1") {
  return {
    id,
    source: "claude-code",
    project_path: "/p",
    file_path: `/p/${id}.jsonl`,
    file_mtime: 0,
    file_size: 0,
    created_at: 0,
    last_active_at: 0,
    message_count: 0,
    auto_title: null,
    custom_title: null,
    category_id: null,
    notes: null,
    favorited: 0 as const,
    archived: 0 as const,
    orphaned: 0 as const,
    content_indexed: 0 as const,
    last_parsed_offset: 0,
    tokens_in: 0,
    tokens_out: 0,
    tokens_cache_read: 0,
    tokens_cache_create: 0,
    turns_indexed: 0 as const,
    turns_last_offset: 0,
  };
}

function makeChunk(overrides: Partial<ChunkRow> = {}): ChunkRow {
  return {
    id: "c1",
    source_kind: "turn",
    source_id: "t1",
    session_id: "s1",
    position: 0,
    text: "hello world",
    char_count: 11,
    created_at: 1700000000000,
    ...overrides,
  };
}

describe("ChunkRepository", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let repo: ChunkRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    repo = new ChunkRepository(db);
    sessionRepo.upsert(makeSession("s1"));
  });

  it("upsertMany inserts rows", () => {
    repo.upsertMany([
      makeChunk({ id: "c1", position: 0 }),
      makeChunk({ id: "c2", position: 1, source_id: "t2" }),
    ]);
    const chunks = repo.listForSession("s1");
    expect(chunks.length).toBe(2);
  });

  it("upsertMany is idempotent and updates text on re-upsert", () => {
    repo.upsertMany([makeChunk({ id: "c1", text: "original", char_count: 8 })]);
    repo.upsertMany([makeChunk({ id: "c1", text: "updated", char_count: 7 })]);
    const chunks = repo.listForSession("s1");
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe("updated");
    expect(chunks[0].char_count).toBe(7);
  });

  it("preserves id on re-upsert", () => {
    repo.upsertMany([makeChunk({ id: "c1" })]);
    repo.upsertMany([makeChunk({ id: "c1", text: "changed" })]);
    const chunks = repo.listForSession("s1");
    expect(chunks[0].id).toBe("c1");
  });

  it("listForSession orders by position ascending", () => {
    repo.upsertMany([
      makeChunk({ id: "c3", position: 2, source_id: "t3" }),
      makeChunk({ id: "c1", position: 0, source_id: "t1" }),
      makeChunk({ id: "c2", position: 1, source_id: "t2" }),
    ]);
    const ids = repo.listForSession("s1").map((c) => c.id);
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });

  it("listForSession only returns chunks for the given session", () => {
    sessionRepo.upsert(makeSession("s2"));
    repo.upsertMany([makeChunk({ id: "c1", session_id: "s1", source_id: "t1" })]);
    repo.upsertMany([makeChunk({ id: "c2", session_id: "s2", source_id: "t2" })]);
    expect(repo.listForSession("s1").map((c) => c.id)).toEqual(["c1"]);
    expect(repo.listForSession("s2").map((c) => c.id)).toEqual(["c2"]);
  });

  it("deleteForSession removes all chunks for session", () => {
    repo.upsertMany([
      makeChunk({ id: "c1", position: 0, source_id: "t1" }),
      makeChunk({ id: "c2", position: 1, source_id: "t2" }),
    ]);
    repo.deleteForSession("s1");
    expect(repo.listForSession("s1")).toEqual([]);
  });

  it("deleteForSession does not remove chunks from other sessions", () => {
    sessionRepo.upsert(makeSession("s2"));
    repo.upsertMany([makeChunk({ id: "c1", session_id: "s1", source_id: "t1" })]);
    repo.upsertMany([makeChunk({ id: "c2", session_id: "s2", source_id: "t2" })]);
    repo.deleteForSession("s1");
    expect(repo.listForSession("s2").map((c) => c.id)).toEqual(["c2"]);
  });

  it("findByIds returns a map of id -> row", () => {
    repo.upsertMany([
      makeChunk({ id: "c1", position: 0, source_id: "t1" }),
      makeChunk({ id: "c2", position: 1, source_id: "t2" }),
    ]);
    const map = repo.findByIds(["c1", "c2", "missing"]);
    expect(map.size).toBe(2);
    expect(map.get("c1")?.id).toBe("c1");
    expect(map.get("c2")?.id).toBe("c2");
    expect(map.has("missing")).toBe(false);
  });

  it("findByIds returns empty map for empty ids", () => {
    expect(repo.findByIds([])).toEqual(new Map());
  });

  it("listAll returns chunks ordered by session_id then position", () => {
    sessionRepo.upsert(makeSession("s2"));
    repo.upsertMany([
      makeChunk({ id: "c2", session_id: "s1", position: 1, source_id: "t2" }),
      makeChunk({ id: "c3", session_id: "s2", position: 0, source_id: "t3" }),
      makeChunk({ id: "c1", session_id: "s1", position: 0, source_id: "t1" }),
    ]);
    const ids = repo.listAll().map((c) => c.id);
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });

  it("upsertMany with empty array does nothing", () => {
    repo.upsertMany([]);
    expect(repo.listForSession("s1")).toEqual([]);
  });
});
