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
        repo_path: null,
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
    expect(fp.by_outcome).toEqual([]);
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

  it("computes question rate when chunks end with ?", () => {
    const now = Date.now();
    chunkRepo.upsertMany([
      {
        id: "c1",
        source_kind: "user_msg",
        source_id: "t1",
        session_id: "s1",
        position: 0,
        text: "Can you help me with this?",
        char_count: 27,
        created_at: now,
      },
      {
        id: "c2",
        source_kind: "user_msg",
        source_id: "t2",
        session_id: "s1",
        position: 1,
        text: "Please refactor this function.",
        char_count: 30,
        created_at: now,
      },
    ]);
    const fp = computeStyleFingerprint(db);
    // 1 of 2 chunks is a question → 50%
    expect(fp.question_rate_pct).toBe(50);
  });

  it("computes code-block rate when text contains fenced blocks", () => {
    const now = Date.now();
    chunkRepo.upsertMany([
      {
        id: "c1",
        source_kind: "user_msg",
        source_id: "t1",
        session_id: "s1",
        position: 0,
        text: "Here is the code:\n```\nconst x = 1;\n```",
        char_count: 39,
        created_at: now,
      },
      {
        id: "c2",
        source_kind: "user_msg",
        source_id: "t2",
        session_id: "s1",
        position: 1,
        text: "No code here, just text.",
        char_count: 25,
        created_at: now,
      },
    ]);
    const fp = computeStyleFingerprint(db);
    // 1 of 2 chunks has a code block → 50%
    expect(fp.code_block_rate_pct).toBe(50);
  });

  it("computes politeness rate when 'please' appears", () => {
    const now = Date.now();
    chunkRepo.upsertMany([
      {
        id: "c1",
        source_kind: "user_msg",
        source_id: "t1",
        session_id: "s1",
        position: 0,
        text: "Please fix this bug and thanks for your help.",
        char_count: 46,
        created_at: now,
      },
    ]);
    const fp = computeStyleFingerprint(db);
    expect(fp.politeness_per_1000_words).toBeGreaterThan(0);
  });

  it("computes vocab richness as ratio of unique to total non-stopword tokens", () => {
    const now = Date.now();
    chunkRepo.upsertMany([
      {
        id: "c1",
        source_kind: "user_msg",
        source_id: "t1",
        session_id: "s1",
        position: 0,
        text: "refactor refactor refactor the authentication module.",
        char_count: 52,
        created_at: now,
      },
    ]);
    const fp = computeStyleFingerprint(db);
    // vocab_richness should be < 1 since "refactor" repeats
    expect(fp.vocab_richness).toBeGreaterThan(0);
    expect(fp.vocab_richness).toBeLessThanOrEqual(1);
  });

  it("extracts top openings from first 3 words", () => {
    const now = Date.now();
    chunkRepo.upsertMany([
      {
        id: "c1",
        source_kind: "user_msg",
        source_id: "t1",
        session_id: "s1",
        position: 0,
        text: "can you please fix this issue",
        char_count: 30,
        created_at: now,
      },
      {
        id: "c2",
        source_kind: "user_msg",
        source_id: "t2",
        session_id: "s1",
        position: 1,
        text: "can you please refactor that",
        char_count: 28,
        created_at: now,
      },
      {
        id: "c3",
        source_kind: "user_msg",
        source_id: "t3",
        session_id: "s2",
        position: 0,
        text: "something completely different here",
        char_count: 35,
        created_at: now,
      },
    ]);
    const fp = computeStyleFingerprint(db);
    // "can you please" appears 2 times → should be in top_openings
    expect(fp.top_openings.some((o) => o.phrase === "can you please")).toBe(true);
    const opening = fp.top_openings.find((o) => o.phrase === "can you please");
    expect(opening?.count).toBe(2);
  });

  it("populates by_outcome when session_outcomes has enough sessions per state", () => {
    const now = Date.now();
    // Create 3 sessions per state: shipped and open
    for (let i = 0; i < 3; i++) {
      const sid = `shipped_${i}`;
      sessionRepo.upsert({ ...makeSession(sid) });
      db.prepare(
        `INSERT INTO session_outcomes (session_id, state, state_inferred_at, user_marked) VALUES (?, 'shipped', ?, 0)`,
      ).run(sid, now);
      chunkRepo.upsertMany([{
        id: `chunk_shipped_${i}`,
        source_kind: "user_msg",
        source_id: `t_shipped_${i}`,
        session_id: sid,
        position: 0,
        text: "Let us ship this feature right away.",
        char_count: 37,
        created_at: now,
      }]);
    }
    for (let i = 0; i < 3; i++) {
      const sid = `open_${i}`;
      sessionRepo.upsert({ ...makeSession(sid) });
      chunkRepo.upsertMany([{
        id: `chunk_open_${i}`,
        source_kind: "user_msg",
        source_id: `t_open_${i}`,
        session_id: sid,
        position: 0,
        text: "Maybe we should try a different approach here.",
        char_count: 46,
        created_at: now,
      }]);
    }
    const fp = computeStyleFingerprint(db);
    expect(fp.by_outcome.length).toBeGreaterThanOrEqual(2);
    const shipped = fp.by_outcome.find((b) => b.outcome === "shipped");
    expect(shipped).toBeDefined();
    expect(shipped!.session_count).toBe(3);
    const open = fp.by_outcome.find((b) => b.outcome === "open");
    expect(open).toBeDefined();
    expect(open!.session_count).toBe(3);
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
