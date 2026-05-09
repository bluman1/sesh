import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { PromptLintRepository, type PromptLintRow } from "../../src/db/promptLints";

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

function makeLint(overrides: Partial<PromptLintRow> = {}): PromptLintRow {
  return {
    id: "lint1",
    session_id: "s1",
    turn_id: "t1",
    message: "This prompt pattern was seen 3 times before.",
    similar_session_ids: ["s2", "s3"],
    detected_at: 1700000000000,
    status: "open",
    ...overrides,
  };
}

describe("PromptLintRepository", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let repo: PromptLintRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    repo = new PromptLintRepository(db);
    sessionRepo.upsert(makeSession("s1"));
  });

  it("upsertMany inserts rows", () => {
    repo.upsertMany([makeLint({ id: "lint1" }), makeLint({ id: "lint2" })]);
    expect(repo.listForSession("s1").length).toBe(2);
  });

  it("upsertMany parses similar_session_ids back as array", () => {
    repo.upsertMany([makeLint({ id: "lint1", similar_session_ids: ["s2", "s3", "s4"] })]);
    const lints = repo.listForSession("s1");
    expect(lints[0].similar_session_ids).toEqual(["s2", "s3", "s4"]);
  });

  it("upsertMany is idempotent and updates message/similar_session_ids", () => {
    repo.upsertMany([
      makeLint({ id: "lint1", message: "original", similar_session_ids: ["s2"] }),
    ]);
    repo.upsertMany([
      makeLint({ id: "lint1", message: "updated", similar_session_ids: ["s2", "s3", "s4"] }),
    ]);
    const lints = repo.listForSession("s1");
    expect(lints.length).toBe(1);
    expect(lints[0].message).toBe("updated");
    expect(lints[0].similar_session_ids).toEqual(["s2", "s3", "s4"]);
  });

  it("listForSession only returns open lints", () => {
    repo.upsertMany([
      makeLint({ id: "lint1", status: "open" }),
      makeLint({ id: "lint2", status: "dismissed" }),
    ]);
    const lints = repo.listForSession("s1");
    expect(lints.map((l) => l.id)).toEqual(["lint1"]);
  });

  it("listForSession scopes to the given session", () => {
    sessionRepo.upsert(makeSession("s2"));
    repo.upsertMany([makeLint({ id: "lint1", session_id: "s1" })]);
    repo.upsertMany([makeLint({ id: "lint2", session_id: "s2" })]);
    expect(repo.listForSession("s1").map((l) => l.id)).toEqual(["lint1"]);
    expect(repo.listForSession("s2").map((l) => l.id)).toEqual(["lint2"]);
  });

  it("setStatus dismissed removes from listForSession", () => {
    repo.upsertMany([makeLint({ id: "lint1", status: "open" })]);
    repo.setStatus("lint1", "dismissed");
    expect(repo.listForSession("s1")).toEqual([]);
  });

  it("upsertMany with empty similar_session_ids stores and retrieves empty array", () => {
    repo.upsertMany([makeLint({ id: "lint1", similar_session_ids: [] })]);
    const lints = repo.listForSession("s1");
    expect(lints[0].similar_session_ids).toEqual([]);
  });

  it("upsertMany with empty array does nothing", () => {
    repo.upsertMany([]);
    expect(repo.listForSession("s1")).toEqual([]);
  });
});
