import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { ChunkRepository } from "../../src/db/chunks";
import { TurnRepository } from "../../src/db/turns";
import { EmbeddingRepository } from "../../src/db/embeddings";
import { PromptLintRepository } from "../../src/db/promptLints";
import { PromptLinter } from "../../src/scanner/promptLinter";
import type { Embedder } from "../../src/embed/types";

class FakeEmbedder implements Embedder {
  readonly modelName = "fake";
  readonly dim = 4;
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const lower = t.toLowerCase();
      const v = new Float32Array(4);
      // "fix it" texts cluster together with high similarity
      v[0] = lower.includes("fix it") ? 1 : 0;
      v[1] = lower.includes("fix") ? 0.8 : 0;
      v[2] = lower.includes("it") ? 0.6 : 0;
      v[3] = lower.includes("architecture") ? 1 : 0;
      return v;
    });
  }
}

function makeSession(id: string) {
  return {
    id,
    source: "claude-code",
    project_path: "/tmp/proj",
    file_path: `/tmp/proj/${id}.jsonl`,
    file_mtime: 0,
    file_size: 0,
    created_at: 0,
    last_active_at: Date.now(),
    message_count: 3,
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

describe("PromptLinter", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let chunkRepo: ChunkRepository;
  let turnRepo: TurnRepository;
  let embeddingRepo: EmbeddingRepository;
  let lintRepo: PromptLintRepository;
  let embedder: FakeEmbedder;
  let linter: PromptLinter;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    chunkRepo = new ChunkRepository(db);
    turnRepo = new TurnRepository(db);
    embeddingRepo = new EmbeddingRepository(db);
    lintRepo = new PromptLintRepository(db);
    embedder = new FakeEmbedder();
    linter = new PromptLinter(db, chunkRepo, embeddingRepo, lintRepo, embedder);

    const now = Date.now();

    // 3 sessions that open with "fix it" style messages
    sessionRepo.upsert(makeSession("s1"));
    sessionRepo.upsert(makeSession("s2"));
    sessionRepo.upsert(makeSession("s3"));
    // 1 control session with a different opening
    sessionRepo.upsert(makeSession("s4"));

    // Seed first user turns for each session
    turnRepo.upsertMany([
      // s1 opening turn
      { id: "t1-open", session_id: "s1", seq: 1, role: "user", model: null,
        ts: now - 4000, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 30, latency_ms: null, is_correction: 0 },
      // s1 correction follow-up
      { id: "t1-corr", session_id: "s1", seq: 3, role: "user", model: null,
        ts: now - 3500, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 30, latency_ms: null, is_correction: 1 },

      // s2 opening turn
      { id: "t2-open", session_id: "s2", seq: 1, role: "user", model: null,
        ts: now - 3000, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 30, latency_ms: null, is_correction: 0 },
      // s2 correction follow-up
      { id: "t2-corr", session_id: "s2", seq: 3, role: "user", model: null,
        ts: now - 2500, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 30, latency_ms: null, is_correction: 1 },

      // s3 opening turn (same style, no corrections — should get linted)
      { id: "t3-open", session_id: "s3", seq: 1, role: "user", model: null,
        ts: now - 2000, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 30, latency_ms: null, is_correction: 0 },

      // s4 control — completely different opening, no corrections
      { id: "t4-open", session_id: "s4", seq: 1, role: "user", model: null,
        ts: now - 1000, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 50, latency_ms: null, is_correction: 0 },
    ]);

    // Seed user_msg chunks for the opening turns (position: 0)
    chunkRepo.upsertMany([
      { id: "c1-open", source_kind: "user_msg", source_id: "t1-open",
        session_id: "s1", position: 0, text: "Fix it in the component please.",
        char_count: 31, created_at: now - 4000 },
      { id: "c2-open", source_kind: "user_msg", source_id: "t2-open",
        session_id: "s2", position: 0, text: "Fix it so the test passes now.",
        char_count: 30, created_at: now - 3000 },
      { id: "c3-open", source_kind: "user_msg", source_id: "t3-open",
        session_id: "s3", position: 0, text: "Fix it and make it work please.",
        char_count: 31, created_at: now - 2000 },
      { id: "c4-open", source_kind: "user_msg", source_id: "t4-open",
        session_id: "s4", position: 0,
        text: "Describe the architecture of this system in detail for me.",
        char_count: 57, created_at: now - 1000 },
    ]);

    // Pre-populate embeddings for all opening chunks
    const fixItVec = new Float32Array([1, 0.8, 0.6, 0]);
    const archVec = new Float32Array([0, 0, 0, 1]);
    embeddingRepo.upsertMany([
      { chunk_id: "c1-open", model_name: "fake", dim: 4, vector: fixItVec },
      { chunk_id: "c2-open", model_name: "fake", dim: 4, vector: fixItVec },
      { chunk_id: "c3-open", model_name: "fake", dim: 4, vector: fixItVec },
      { chunk_id: "c4-open", model_name: "fake", dim: 4, vector: archVec },
    ]);
  });

  it("creates a lint for s3 referencing the 2 similar corrected sessions (s1, s2)", async () => {
    await linter.run();
    const allLints = db.prepare("SELECT * FROM prompt_lints").all() as Array<{
      id: string; session_id: string; status: string; similar_session_ids: string;
    }>;
    const s3Lint = allLints.find((l) => l.session_id === "s3");
    expect(s3Lint).toBeDefined();
    expect(s3Lint!.status).toBe("open");
    const similarIds = JSON.parse(s3Lint!.similar_session_ids) as string[];
    expect(similarIds).toContain("s1");
    expect(similarIds).toContain("s2");
  });

  it("does not create a lint for the control session (s4)", async () => {
    await linter.run();
    const allLints = db.prepare("SELECT * FROM prompt_lints").all() as Array<{
      session_id: string;
    }>;
    const s4Lint = allLints.find((l) => l.session_id === "s4");
    expect(s4Lint).toBeUndefined();
  });

  it("is idempotent — running twice does not duplicate lints", async () => {
    await linter.run();
    const countFirst = (db.prepare("SELECT COUNT(*) as c FROM prompt_lints").get() as { c: number }).c;
    await linter.run();
    const countSecond = (db.prepare("SELECT COUNT(*) as c FROM prompt_lints").get() as { c: number }).c;
    expect(countSecond).toBe(countFirst);
  });

  it("returns early when no embeddings exist", async () => {
    db.prepare("DELETE FROM embeddings").run();
    await linter.run();
    const lints = db.prepare("SELECT COUNT(*) as c FROM prompt_lints").get() as { c: number };
    expect(lints.c).toBe(0);
  });

  it("does not lint a session that has no similar corrected sessions", async () => {
    // Remove s1 and s2 corrections so no session has corrections
    db.prepare("UPDATE turns SET is_correction = 0").run();
    await linter.run();
    const lints = db.prepare("SELECT COUNT(*) as c FROM prompt_lints").get() as { c: number };
    expect(lints.c).toBe(0);
  });
});
