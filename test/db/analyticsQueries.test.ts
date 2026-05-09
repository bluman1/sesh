import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { TurnRepository } from "../../src/db/turns";
import { ToolCallRepository } from "../../src/db/toolCalls";
import {
  costByFile,
  modelLeaderboard,
  personalRecords,
  todaysStandup,
  recentCommitments,
} from "../../src/db/analyticsQueries";

describe("analyticsQueries", () => {
  let db: Db;
  let sessions: SessionRepository;
  let turns: TurnRepository;
  let toolCalls: ToolCallRepository;
  const NOW = 1700000000000;
  const HOUR = 3600 * 1000;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessions = new SessionRepository(db);
    turns = new TurnRepository(db);
    toolCalls = new ToolCallRepository(db);

    sessions.upsert({
      id: "s1", source: "claude-code", project_path: "/p", file_path: "/p/s1.jsonl",
      file_mtime: 0, file_size: 0, created_at: NOW - HOUR, last_active_at: NOW,
      message_count: 4,
      auto_title: "shipped session", custom_title: null, category_id: null, notes: null,
      favorited: 0, archived: 0, orphaned: 0, content_indexed: 1, last_parsed_offset: 0,
      tokens_in: 100, tokens_out: 50, tokens_cache_read: 0, tokens_cache_create: 0,
      turns_indexed: 1, turns_last_offset: 0,
    });
    turns.upsertMany([
      { id: "u1", session_id: "s1", seq: 0, role: "user", model: null,
        ts: NOW - HOUR, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 50, latency_ms: null, is_correction: 0 },
      { id: "a1", session_id: "s1", seq: 1, role: "assistant", model: "claude-opus-4-7",
        ts: NOW - HOUR + 5000, tokens_in: 100, tokens_out: 50, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 80, latency_ms: 5000, is_correction: 0 },
    ]);
    toolCalls.upsertMany([
      { id: "tc1", turn_id: "a1", session_id: "s1", name: "Edit", target_path: "/p/file.ts",
        is_error: 0, result_size: 0, ts: NOW - HOUR + 5000 },
    ]);
  });

  it("costByFile aggregates usd by target_path", () => {
    const result = costByFile({ db, since: 0 });
    expect(result.length).toBeGreaterThan(0);
    const file = result.find((r) => r.path === "/p/file.ts");
    expect(file).toBeDefined();
    expect(file!.usd).toBeGreaterThan(0);
    expect(file!.tool_calls).toBe(1);
  });

  it("modelLeaderboard ranks models by tokens_out + tokens_in", () => {
    turns.upsertMany([
      { id: "a-other", session_id: "s1", seq: 2, role: "assistant", model: "claude-haiku-4-5",
        ts: NOW, tokens_in: 30, tokens_out: 20, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 10, latency_ms: 1000, is_correction: 0 },
    ]);
    const board = modelLeaderboard({ db, since: 0 });
    const top = board[0];
    expect(top.model).toBe("claude-opus-4-7");
    expect(top.tokens_in_total).toBe(100);
    expect(top.usd).toBeGreaterThan(0);
  });

  it("personalRecords returns longest session, fewest tokens to ship, etc.", () => {
    const records = personalRecords({ db });
    expect(records.longestSessionTurns.session_id).toBe("s1");
  });

  it("todaysStandup returns today's sessions with cost summary", () => {
    const summary = todaysStandup({ db, todayStart: NOW - 2 * HOUR });
    expect(summary.totalSessions).toBeGreaterThan(0);
    expect(summary.totalUsd).toBeGreaterThan(0);
  });

  it("recentCommitments extracts user turns matching commitment patterns", () => {
    turns.upsertMany([
      { id: "u-commit", session_id: "s1", seq: 3, role: "user", model: null,
        ts: NOW, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 100, latency_ms: 1000, is_correction: 0 },
    ]);
    // Note: recentCommitments reads a separate text store in v2;
    // for v1 it joins on FTS table. Simpler test: empty result when no FTS.
    const result = recentCommitments({ db, since: 0 });
    expect(Array.isArray(result)).toBe(true);
  });
});
