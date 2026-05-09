import { describe, it, expect, beforeEach } from "vitest";
import * as path from "node:path";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { TurnRepository } from "../../src/db/turns";
import { ChunkRepository } from "../../src/db/chunks";
import { EmbeddingRepository } from "../../src/db/embeddings";
import { EmbeddingIndexer } from "../../src/scanner/embeddingIndexer";
import type { Embedder } from "../../src/embed/types";

const FIXTURE = path.join(__dirname, "..", "fixtures", "embed-sample.jsonl");

class FakeEmbedder implements Embedder {
  readonly modelName = "fake-model";
  readonly dim = 4;
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(4);
      v[0] = t.length;
      v[1] = t.charCodeAt(0) || 0;
      return v;
    });
  }
}

function makeSession(id: string, filePath: string) {
  return {
    id,
    source: "claude-code",
    project_path: "/tmp/proj",
    file_path: filePath,
    file_mtime: 0,
    file_size: 0,
    created_at: 0,
    last_active_at: 0,
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

describe("EmbeddingIndexer", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let turnRepo: TurnRepository;
  let chunkRepo: ChunkRepository;
  let embeddingRepo: EmbeddingRepository;
  let embedder: FakeEmbedder;
  let indexer: EmbeddingIndexer;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    turnRepo = new TurnRepository(db);
    chunkRepo = new ChunkRepository(db);
    embeddingRepo = new EmbeddingRepository(db);
    embedder = new FakeEmbedder();
    indexer = new EmbeddingIndexer(
      db,
      sessionRepo,
      turnRepo,
      chunkRepo,
      embeddingRepo,
      embedder,
    );

    // Seed session with turns_indexed=1 (prerequisite for embedding indexing).
    sessionRepo.upsert(makeSession("s-embed", FIXTURE));

    // Seed turns matching the fixture (u1=user, a1=assistant).
    turnRepo.upsertMany([
      {
        id: "u1",
        session_id: "s-embed",
        seq: 0,
        role: "user",
        model: null,
        ts: 1735725600000,
        tokens_in: 0,
        tokens_out: 0,
        tokens_cache_read: 0,
        tokens_cache_create: 0,
        text_len: 32,
        latency_ms: null,
        is_correction: 0,
      },
      {
        id: "a1",
        session_id: "s-embed",
        seq: 1,
        role: "assistant",
        model: "claude-opus-4-7",
        ts: 1735725605000,
        tokens_in: 20,
        tokens_out: 30,
        tokens_cache_read: 0,
        tokens_cache_create: 0,
        text_len: 113,
        latency_ms: 5000,
        is_correction: 0,
      },
    ]);
  });

  it("indexes chunks and embeddings from JSONL fixture", async () => {
    await indexer.run();

    const chunks = chunkRepo.listForSession("s-embed");
    expect(chunks.length).toBeGreaterThan(0);

    const embeddings = embeddingRepo.listAll("fake-model");
    expect(embeddings.length).toBe(chunks.length);

    // Chunk ids should follow the pattern turn_id#position.
    for (const chunk of chunks) {
      expect(chunk.id).toMatch(/^(u1|a1)#\d+$/);
    }
  });

  it("user turn produces 'user_msg' chunks, assistant produces 'turn' chunks", async () => {
    await indexer.run();
    const chunks = chunkRepo.listForSession("s-embed");
    const userChunks = chunks.filter((c) => c.source_id === "u1");
    const assistantChunks = chunks.filter((c) => c.source_id === "a1");

    expect(userChunks.length).toBeGreaterThan(0);
    expect(userChunks.every((c) => c.source_kind === "user_msg")).toBe(true);

    expect(assistantChunks.length).toBeGreaterThan(0);
    expect(assistantChunks.every((c) => c.source_kind === "turn")).toBe(true);
  });

  it("re-running is idempotent — does not create duplicate chunks or embeddings", async () => {
    await indexer.run();
    const chunksAfterFirst = chunkRepo.listForSession("s-embed").length;
    const embeddingsAfterFirst = embeddingRepo.listAll("fake-model").length;

    await indexer.run();
    expect(chunkRepo.listForSession("s-embed").length).toBe(chunksAfterFirst);
    expect(embeddingRepo.listAll("fake-model").length).toBe(embeddingsAfterFirst);
  });

  it("skips sessions whose JSONL file does not exist", async () => {
    sessionRepo.upsert(makeSession("s-missing", "/nonexistent/path/missing.jsonl"));
    turnRepo.upsertMany([
      {
        id: "x1",
        session_id: "s-missing",
        seq: 0,
        role: "user",
        model: null,
        ts: 0,
        tokens_in: 0,
        tokens_out: 0,
        tokens_cache_read: 0,
        tokens_cache_create: 0,
        text_len: 5,
        latency_ms: null,
        is_correction: 0,
      },
    ]);
    // Should not throw.
    await indexer.run();
    expect(chunkRepo.listForSession("s-missing")).toHaveLength(0);
  });

  it("reports progress callbacks", async () => {
    const events: { d: number; t: number }[] = [];
    indexer.setProgressHandler((d, t) => events.push({ d, t }));
    await indexer.run();
    expect(events.length).toBeGreaterThanOrEqual(2);
    // Last event: done === total.
    const last = events[events.length - 1];
    expect(last.d).toBe(last.t);
  });

  it("cancel() stops the run without throwing", async () => {
    const promise = indexer.run();
    indexer.cancel();
    await promise; // Should resolve, not reject.
  });

  it("does not index orphaned sessions", async () => {
    sessionRepo.markOrphaned("s-embed");
    await indexer.run();
    expect(chunkRepo.listForSession("s-embed")).toHaveLength(0);
  });

  it("does not index sessions with turns_indexed=0", async () => {
    // Insert a session that has NOT had turns indexed yet.
    sessionRepo.upsert(makeSession("s-unindexed", FIXTURE));
    // Overwrite with turns_indexed=0.
    db.prepare("UPDATE sessions SET turns_indexed = 0 WHERE id = 's-unindexed'").run();

    // Also seed turns for it (just in case).
    turnRepo.upsertMany([
      {
        id: "v1",
        session_id: "s-unindexed",
        seq: 0,
        role: "user",
        model: null,
        ts: 0,
        tokens_in: 0,
        tokens_out: 0,
        tokens_cache_read: 0,
        tokens_cache_create: 0,
        text_len: 5,
        latency_ms: null,
        is_correction: 0,
      },
    ]);

    await indexer.run();
    // s-embed should be indexed, s-unindexed should not.
    expect(chunkRepo.listForSession("s-unindexed")).toHaveLength(0);
  });
});
