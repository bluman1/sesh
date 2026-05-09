import { describe, it, expect, beforeEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { ChunkRepository } from "../../src/db/chunks";
import { computeStyleFingerprint, exportFingerprintToFile } from "../../src/scanner/styleFingerprint";

function makeSession(id: string) {
  return {
    id,
    source: "claude-code" as const,
    project_path: "/tmp/proj",
    file_path: "/tmp/proj/session.jsonl",
    file_mtime: 0,
    file_size: 0,
    created_at: 0,
    last_active_at: Date.now(),
    message_count: 2,
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
    turns_indexed: 1 as const,
    turns_last_offset: 0,
  };
}

describe("computeStyleFingerprint", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let chunkRepo: ChunkRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    chunkRepo = new ChunkRepository(db);
    sessionRepo.upsert(makeSession("s1"));
    sessionRepo.upsert(makeSession("s2"));
  });

  it("returns all zeros when there are no user_msg chunks", () => {
    const fp = computeStyleFingerprint(db);
    expect(fp.source_session_count).toBe(0);
    expect(fp.source_chunk_count).toBe(0);
    expect(fp.total_chars).toBe(0);
    expect(fp.avg_user_chars_per_turn).toBe(0);
    expect(fp.avg_words_per_sentence).toBe(0);
    expect(fp.hedging_per_1000_words).toBe(0);
    expect(fp.exclamation_per_1000_chars).toBe(0);
    expect(fp.capital_letter_rate).toBe(0);
    expect(fp.top_tokens).toHaveLength(0);
  });

  it("detects hedging when chunk contains 'maybe'", () => {
    const now = Date.now();
    chunkRepo.upsertMany([
      {
        id: "c1",
        source_kind: "user_msg",
        source_id: "t1",
        session_id: "s1",
        position: 0,
        text: "Maybe we should refactor the authentication module.",
        char_count: 51,
        created_at: now,
      },
    ]);
    const fp = computeStyleFingerprint(db);
    expect(fp.hedging_per_1000_words).toBeGreaterThan(0);
  });

  it("computes avg_user_chars_per_turn correctly across multiple chunks", () => {
    const now = Date.now();
    const text1 = "Hello world this is a test message.";
    const text2 = "Another message with more words in it here.";
    chunkRepo.upsertMany([
      {
        id: "c1",
        source_kind: "user_msg",
        source_id: "t1",
        session_id: "s1",
        position: 0,
        text: text1,
        char_count: text1.length,
        created_at: now,
      },
      {
        id: "c2",
        source_kind: "user_msg",
        source_id: "t2",
        session_id: "s2",
        position: 0,
        text: text2,
        char_count: text2.length,
        created_at: now,
      },
    ]);
    const fp = computeStyleFingerprint(db);
    expect(fp.source_chunk_count).toBe(2);
    const expected = Math.round((text1.length + text2.length) / 2);
    expect(fp.avg_user_chars_per_turn).toBe(expected);
  });

  it("excludes stopwords and short words from top_tokens", () => {
    const now = Date.now();
    chunkRepo.upsertMany([
      {
        id: "c1",
        source_kind: "user_msg",
        source_id: "t1",
        session_id: "s1",
        position: 0,
        text: "The quick brown fox jumps over the lazy dog. And the fox was quick.",
        char_count: 68,
        created_at: now,
      },
    ]);
    const fp = computeStyleFingerprint(db);
    const tokenNames = fp.top_tokens.map((t) => t.token);
    // stopwords should not appear
    expect(tokenNames).not.toContain("the");
    expect(tokenNames).not.toContain("and");
    expect(tokenNames).not.toContain("was");
    // short words (< 3 chars) should not appear
    expect(tokenNames).not.toContain("in");
    // longer meaningful words should appear
    expect(tokenNames).toContain("quick");
  });

  it("does not count non-user_msg chunks", () => {
    const now = Date.now();
    chunkRepo.upsertMany([
      {
        id: "c-turn",
        source_kind: "turn",
        source_id: "t1",
        session_id: "s1",
        position: 0,
        text: "Maybe this is an assistant message with hedges.",
        char_count: 47,
        created_at: now,
      },
    ]);
    const fp = computeStyleFingerprint(db);
    expect(fp.source_chunk_count).toBe(0);
    expect(fp.hedging_per_1000_words).toBe(0);
  });

  it("generated_at is a recent timestamp", () => {
    const before = Date.now();
    const fp = computeStyleFingerprint(db);
    const after = Date.now();
    expect(fp.generated_at).toBeGreaterThanOrEqual(before);
    expect(fp.generated_at).toBeLessThanOrEqual(after);
  });
});

describe("exportFingerprintToFile", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
  });

  it("writes valid JSON to a temp path", () => {
    const fp = computeStyleFingerprint(db);
    const tmpPath = path.join(os.tmpdir(), `sesh-fp-test-${Date.now()}.json`);
    try {
      exportFingerprintToFile(fp, tmpPath);
      const raw = fs.readFileSync(tmpPath, "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveProperty("generated_at");
      expect(parsed).toHaveProperty("top_tokens");
      expect(Array.isArray(parsed.top_tokens)).toBe(true);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });
});
