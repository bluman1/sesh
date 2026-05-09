import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { ChunkRepository } from "../../src/db/chunks";
import { EmbeddingRepository } from "../../src/db/embeddings";
import {
  semanticSearch,
  findSimilarTurns,
} from "../../src/db/semanticQueries";
import type { Embedder } from "../../src/embed/types";

class FakeEmbedder implements Embedder {
  readonly modelName = "fake-model";
  readonly dim = 4;

  /**
   * Returns a deterministic vector based on the text.
   * We encode specific texts to specific directions to control ranking.
   */
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(4);
      // Encode text into a simple deterministic vector.
      for (let i = 0; i < Math.min(t.length, 4); i++) {
        v[i] = t.charCodeAt(i) / 128;
      }
      return v;
    });
  }
}

function makeSession(id: string, title?: string) {
  return {
    id,
    source: "claude-code",
    project_path: `/p/${id}`,
    file_path: `/p/${id}/session.jsonl`,
    file_mtime: 0,
    file_size: 0,
    created_at: 0,
    last_active_at: 0,
    message_count: 1,
    auto_title: title ?? null,
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

function seedChunkAndEmbedding(
  chunkRepo: ChunkRepository,
  embeddingRepo: EmbeddingRepository,
  embedder: FakeEmbedder,
  chunkId: string,
  sessionId: string,
  text: string,
) {
  chunkRepo.upsertMany([
    {
      id: chunkId,
      source_kind: "turn",
      source_id: chunkId,
      session_id: sessionId,
      position: 0,
      text,
      char_count: text.length,
      created_at: Date.now(),
    },
  ]);
  // Synchronously compute a fake vector.
  const v = new Float32Array(4);
  for (let i = 0; i < Math.min(text.length, 4); i++) {
    v[i] = text.charCodeAt(i) / 128;
  }
  embeddingRepo.upsertMany([
    {
      chunk_id: chunkId,
      model_name: embedder.modelName,
      dim: embedder.dim,
      vector: v,
    },
  ]);
}

describe("semanticSearch", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let chunkRepo: ChunkRepository;
  let embeddingRepo: EmbeddingRepository;
  let embedder: FakeEmbedder;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    chunkRepo = new ChunkRepository(db);
    embeddingRepo = new EmbeddingRepository(db);
    embedder = new FakeEmbedder();
  });

  it("returns [] for empty query without calling embedder", async () => {
    // Even with seeded data, empty query should short-circuit.
    sessionRepo.upsert(makeSession("s1", "Test Session"));
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c1", "s1", "abc");

    const results = await semanticSearch(db, embedder, "");
    expect(results).toEqual([]);
  });

  it("returns [] for whitespace-only query", async () => {
    const results = await semanticSearch(db, embedder, "   ");
    expect(results).toEqual([]);
  });

  it("returns [] when no embeddings exist", async () => {
    sessionRepo.upsert(makeSession("s1", "Session"));
    const results = await semanticSearch(db, embedder, "hello");
    expect(results).toEqual([]);
  });

  it("returns hits ordered by descending cosine score", async () => {
    sessionRepo.upsert(makeSession("s1", "Session A"));
    sessionRepo.upsert(makeSession("s2", "Session B"));

    // "abc" starts with 'a' (97). "xyz" starts with 'x' (120).
    // Query "abc" should be closer to chunk with text starting with 'a'.
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c1", "s1", "abcd");
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c2", "s2", "xyzw");

    const results = await semanticSearch(db, embedder, "abcd");
    expect(results.length).toBeGreaterThan(0);
    // First hit should have the higher score.
    if (results.length > 1) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
    // Top hit should be from s1 (same text as query).
    expect(results[0].session_id).toBe("s1");
  });

  it("respects the limit option", async () => {
    // Seed 5 sessions with chunks.
    for (let i = 0; i < 5; i++) {
      sessionRepo.upsert(makeSession(`s${i}`, `Session ${i}`));
      seedChunkAndEmbedding(
        chunkRepo,
        embeddingRepo,
        embedder,
        `c${i}`,
        `s${i}`,
        `text${i}`,
      );
    }

    const results = await semanticSearch(db, embedder, "text0", { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("includes session title and project path in results", async () => {
    sessionRepo.upsert(makeSession("s1", "My Session Title"));
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c1", "s1", "hello");

    const results = await semanticSearch(db, embedder, "hello");
    expect(results).toHaveLength(1);
    expect(results[0].session_title).toBe("My Session Title");
    expect(results[0].session_project_path).toBe("/p/s1");
  });

  it("returns '(untitled)' when session has no title", async () => {
    sessionRepo.upsert(makeSession("s1")); // no title
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c1", "s1", "hello");

    const results = await semanticSearch(db, embedder, "hello");
    expect(results[0].session_title).toBe("(untitled)");
  });

  it("chunk property is populated in results", async () => {
    sessionRepo.upsert(makeSession("s1", "Session"));
    seedChunkAndEmbedding(
      chunkRepo,
      embeddingRepo,
      embedder,
      "c1",
      "s1",
      "hello world",
    );

    const results = await semanticSearch(db, embedder, "hello world");
    expect(results[0].chunk).toBeDefined();
    expect(results[0].chunk.id).toBe("c1");
    expect(results[0].chunk.text).toBe("hello world");
  });
});

describe("findSimilarTurns", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let chunkRepo: ChunkRepository;
  let embeddingRepo: EmbeddingRepository;
  let embedder: FakeEmbedder;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    chunkRepo = new ChunkRepository(db);
    embeddingRepo = new EmbeddingRepository(db);
    embedder = new FakeEmbedder();
  });

  it("returns [] when seed chunk has no embedding", async () => {
    sessionRepo.upsert(makeSession("s1", "S1"));
    chunkRepo.upsertMany([
      {
        id: "c1",
        source_kind: "turn",
        source_id: "c1",
        session_id: "s1",
        position: 0,
        text: "hello",
        char_count: 5,
        created_at: Date.now(),
      },
    ]);
    // No embedding for c1.
    const results = await findSimilarTurns(db, "c1", "fake-model");
    expect(results).toEqual([]);
  });

  it("excludes the seed chunk itself from results", async () => {
    sessionRepo.upsert(makeSession("s1", "S1"));
    sessionRepo.upsert(makeSession("s2", "S2"));

    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c1", "s1", "abcd");
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c2", "s2", "abcd");

    const results = await findSimilarTurns(db, "c1", "fake-model");
    // c1 should never appear in its own results.
    expect(results.every((r) => r.chunk.id !== "c1")).toBe(true);
  });

  it("excludes chunks from excludeSession", async () => {
    sessionRepo.upsert(makeSession("s1", "S1"));
    sessionRepo.upsert(makeSession("s2", "S2"));
    sessionRepo.upsert(makeSession("s3", "S3"));

    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c1", "s1", "abcd");
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c2", "s2", "abcd");
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c3", "s3", "abcd");

    const results = await findSimilarTurns(db, "c1", "fake-model", {
      excludeSession: "s2",
    });
    expect(results.every((r) => r.session_id !== "s2")).toBe(true);
  });

  it("returns results ordered by descending cosine score", async () => {
    sessionRepo.upsert(makeSession("s1", "S1"));
    sessionRepo.upsert(makeSession("s2", "S2"));
    sessionRepo.upsert(makeSession("s3", "S3"));

    // c1 is the seed; c2 has same text (high similarity); c3 has different text (lower similarity).
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c1", "s1", "abcd");
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c2", "s2", "abcd");
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c3", "s3", "xyzw");

    const results = await findSimilarTurns(db, "c1", "fake-model");
    expect(results.length).toBeGreaterThan(0);
    if (results.length > 1) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });

  it("respects the limit option", async () => {
    sessionRepo.upsert(makeSession("s1", "S1"));
    for (let i = 2; i <= 6; i++) {
      sessionRepo.upsert(makeSession(`s${i}`, `S${i}`));
      seedChunkAndEmbedding(
        chunkRepo,
        embeddingRepo,
        embedder,
        `c${i}`,
        `s${i}`,
        "abcd",
      );
    }
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c1", "s1", "abcd");

    const results = await findSimilarTurns(db, "c1", "fake-model", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("returns [] when no other embeddings exist", async () => {
    sessionRepo.upsert(makeSession("s1", "S1"));
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, embedder, "c1", "s1", "hello");

    // c1 is the only embedding — after excluding itself, nothing remains.
    const results = await findSimilarTurns(db, "c1", "fake-model");
    expect(results).toEqual([]);
  });
});
