import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { TurnRepository } from "../../src/db/turns";
import { ToolCallRepository, type ToolCallRow } from "../../src/db/toolCalls";

function makeToolCall(overrides: Partial<ToolCallRow> = {}): ToolCallRow {
  return {
    id: "tc1",
    turn_id: "a1",
    session_id: "s1",
    name: "Edit",
    target_path: "/p/file.ts",
    is_error: 0,
    result_size: 0,
    ts: 1700000000000,
    ...overrides,
  };
}

describe("ToolCallRepository", () => {
  let db: Db;
  let repo: ToolCallRepository;

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
      turns_indexed: 0, turns_last_offset: 0,
    });
    const turns = new TurnRepository(db);
    turns.upsertMany([{
      id: "a1", session_id: "s1", seq: 0, role: "assistant",
      model: "claude-opus-4-7", ts: 1700000000000,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
      text_len: 0, latency_ms: null, is_correction: 0,
    }]);
    repo = new ToolCallRepository(db);
  });

  it("upsertMany inserts batch", () => {
    repo.upsertMany([
      makeToolCall({ id: "tc1", name: "Edit", target_path: "/p/a.ts" }),
      makeToolCall({ id: "tc2", name: "Bash", target_path: null }),
    ]);
    expect(repo.listBySession("s1").length).toBe(2);
  });

  it("listByPath filters by target_path", () => {
    repo.upsertMany([
      makeToolCall({ id: "tc1", target_path: "/p/a.ts" }),
      makeToolCall({ id: "tc2", target_path: "/p/b.ts" }),
    ]);
    expect(repo.listByPath("/p/a.ts").map((t) => t.id)).toEqual(["tc1"]);
  });

  it("listByName filters by tool name", () => {
    repo.upsertMany([
      makeToolCall({ id: "tc1", name: "Edit" }),
      makeToolCall({ id: "tc2", name: "Bash" }),
    ]);
    expect(repo.listByName("Bash").map((t) => t.id)).toEqual(["tc2"]);
  });

  it("topToolsForSessions returns aggregate counts", () => {
    repo.upsertMany([
      makeToolCall({ id: "a", name: "Edit" }),
      makeToolCall({ id: "b", name: "Edit" }),
      makeToolCall({ id: "c", name: "Bash" }),
    ]);
    const top = repo.topToolsForSessions(["s1"]);
    expect(top.find((t) => t.name === "Edit")?.count).toBe(2);
    expect(top.find((t) => t.name === "Bash")?.count).toBe(1);
  });
});
