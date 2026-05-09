import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { ChunkRepository } from "../../src/db/chunks";
import { TurnRepository } from "../../src/db/turns";
import { ClaudeMdSuggestionRepository } from "../../src/db/claudeMd";
import { CorrectionMiner } from "../../src/scanner/correctionMiner";
import type { Embedder } from "../../src/embed/types";

class FakeEmbedder implements Embedder {
  readonly modelName = "fake";
  readonly dim = 4;
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const lower = t.toLowerCase();
      const v = new Float32Array(4);
      // texts mentioning "tabs" cluster together
      v[0] = lower.includes("tabs") ? 1 : 0;
      v[1] = lower.includes("spaces") ? 1 : 0;
      v[2] = lower.includes("indentation") ? 0.5 : 0;
      v[3] = lower.includes("tabs") || lower.includes("spaces") ? 0.8 : 0;
      return v;
    });
  }
}

function makeSession(id: string) {
  return {
    id,
    source: "claude-code",
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

describe("CorrectionMiner", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let chunkRepo: ChunkRepository;
  let turnRepo: TurnRepository;
  let suggestionRepo: ClaudeMdSuggestionRepository;
  let embedder: FakeEmbedder;
  let miner: CorrectionMiner;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    chunkRepo = new ChunkRepository(db);
    turnRepo = new TurnRepository(db);
    suggestionRepo = new ClaudeMdSuggestionRepository(db);
    embedder = new FakeEmbedder();
    miner = new CorrectionMiner(db, chunkRepo, suggestionRepo, embedder);

    // Seed sessions
    sessionRepo.upsert(makeSession("s1"));
    sessionRepo.upsert(makeSession("s2"));

    const now = Date.now();

    // Seed 3 turns flagged as corrections that all mention "tabs over spaces"
    turnRepo.upsertMany([
      {
        id: "t1", session_id: "s1", seq: 1, role: "user", model: null,
        ts: now - 3000, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 50, latency_ms: null, is_correction: 1,
      },
      {
        id: "t2", session_id: "s1", seq: 3, role: "user", model: null,
        ts: now - 2000, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 50, latency_ms: null, is_correction: 1,
      },
      {
        id: "t3", session_id: "s2", seq: 1, role: "user", model: null,
        ts: now - 1000, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 50, latency_ms: null, is_correction: 1,
      },
      // 2 unrelated correction turns
      {
        id: "t4", session_id: "s1", seq: 5, role: "user", model: null,
        ts: now - 500, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 50, latency_ms: null, is_correction: 1,
      },
      {
        id: "t5", session_id: "s2", seq: 3, role: "user", model: null,
        ts: now - 100, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
        tokens_cache_create: 0, text_len: 50, latency_ms: null, is_correction: 1,
      },
    ]);

    // Seed user_msg chunks for the correction turns
    chunkRepo.upsertMany([
      // 3 chunks that mention tabs/spaces — should cluster together
      {
        id: "c1", source_kind: "user_msg", source_id: "t1", session_id: "s1",
        position: 0, text: "No, please use tabs over spaces for indentation in this project.",
        char_count: 62, created_at: now - 3000,
      },
      {
        id: "c2", source_kind: "user_msg", source_id: "t2", session_id: "s1",
        position: 0, text: "I said tabs not spaces, always use tabs for indentation.",
        char_count: 56, created_at: now - 2000,
      },
      {
        id: "c3", source_kind: "user_msg", source_id: "t3", session_id: "s2",
        position: 0, text: "Please use tabs instead of spaces — this is the third time about indentation.",
        char_count: 75, created_at: now - 1000,
      },
      // 2 unrelated short texts (will be separate clusters, size < 3)
      {
        id: "c4", source_kind: "user_msg", source_id: "t4", session_id: "s1",
        position: 0, text: "Don't use console.log in production code, use a proper logger.",
        char_count: 61, created_at: now - 500,
      },
      {
        id: "c5", source_kind: "user_msg", source_id: "t5", session_id: "s2",
        position: 0, text: "Function names should be camelCase not snake_case in JavaScript.",
        char_count: 62, created_at: now - 100,
      },
    ]);
  });

  it("produces a suggestion for the cluster of 3 tabs/spaces corrections", async () => {
    await miner.run();
    const suggestions = suggestionRepo.listOpen();
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    const tabsSuggestion = suggestions.find((s) => s.source_count >= 3);
    expect(tabsSuggestion).toBeDefined();
    expect(tabsSuggestion!.body).toContain("3");
    expect(tabsSuggestion!.status).toBe("open");
  });

  it("does not produce a suggestion for clusters smaller than MIN_CLUSTER_SIZE (3)", async () => {
    await miner.run();
    const suggestions = suggestionRepo.listOpen();
    // Unrelated chunks (c4, c5) each form their own cluster of size 1 — no suggestion
    const smallClusters = suggestions.filter((s) => s.source_count < 3);
    expect(smallClusters).toHaveLength(0);
  });

  it("returns early when no is_correction turns exist", async () => {
    db.prepare("DELETE FROM turns").run();
    await miner.run();
    expect(suggestionRepo.listOpen()).toHaveLength(0);
  });

  it("is idempotent — running twice does not duplicate suggestions", async () => {
    await miner.run();
    const countFirst = suggestionRepo.listOpen().length;
    await miner.run();
    expect(suggestionRepo.listOpen().length).toBe(countFirst);
  });

  it("skips chunks shorter than 30 characters", async () => {
    db.prepare("DELETE FROM chunks").run();
    // Insert very short correction chunks
    chunkRepo.upsertMany([
      { id: "short1", source_kind: "user_msg", source_id: "t1", session_id: "s1",
        position: 0, text: "Use tabs.", char_count: 9, created_at: Date.now() },
      { id: "short2", source_kind: "user_msg", source_id: "t2", session_id: "s1",
        position: 0, text: "Tabs please.", char_count: 12, created_at: Date.now() },
      { id: "short3", source_kind: "user_msg", source_id: "t3", session_id: "s2",
        position: 0, text: "Use tabs!", char_count: 9, created_at: Date.now() },
    ]);
    await miner.run();
    expect(suggestionRepo.listOpen()).toHaveLength(0);
  });
});
