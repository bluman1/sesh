import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { ChunkRepository } from "../../src/db/chunks";
import { EmbeddingRepository } from "../../src/db/embeddings";
import { computeTopics } from "../../src/db/topicsQuery";

const MODEL = "fake-model";

function makeSession(id: string) {
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

function seedChunkAndEmbedding(
  chunkRepo: ChunkRepository,
  embeddingRepo: EmbeddingRepository,
  chunkId: string,
  sessionId: string,
  text: string,
  vector: Float32Array,
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
  embeddingRepo.upsertMany([
    {
      chunk_id: chunkId,
      model_name: MODEL,
      dim: vector.length,
      vector,
    },
  ]);
}

describe("computeTopics", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let chunkRepo: ChunkRepository;
  let embeddingRepo: EmbeddingRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    chunkRepo = new ChunkRepository(db);
    embeddingRepo = new EmbeddingRepository(db);
  });

  it("returns [] when no embeddings exist", () => {
    const topics = computeTopics(db, MODEL);
    expect(topics).toEqual([]);
  });

  it("clusters similar embeddings and returns topics with size >= 2", () => {
    sessionRepo.upsert(makeSession("s1"));
    sessionRepo.upsert(makeSession("s2"));
    sessionRepo.upsert(makeSession("s3"));
    sessionRepo.upsert(makeSession("s4"));

    // A long enough text (>= 40 chars) is required for a chunk to be included
    const longText = (s: string) => s.padEnd(50, " ") + "extra filler text here for length";

    // c1 and c2 share nearly identical vectors — should cluster together (cosine ~ 1.0)
    const similar = new Float32Array([1, 0, 0, 0]);
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, "c1", "s1", longText("alpha"), similar);
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, "c2", "s2", longText("alpha"), similar);

    // c3 and c4 have very different vectors — should form separate clusters (or none if singleton)
    const diff1 = new Float32Array([0, 1, 0, 0]);
    const diff2 = new Float32Array([0, 0, 1, 0]);
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, "c3", "s3", longText("beta"), diff1);
    seedChunkAndEmbedding(chunkRepo, embeddingRepo, "c4", "s4", longText("gamma"), diff2);

    const topics = computeTopics(db, MODEL);

    // Only one cluster of size >= 2 should be returned (c1+c2)
    expect(topics.length).toBe(1);
    expect(topics[0].size).toBe(2);
    expect(topics[0].session_count).toBe(2);
    expect(topics[0].example_session_ids).toContain("s1");
    expect(topics[0].example_session_ids).toContain("s2");
  });

  it("respects the limit option", () => {
    // Create 3 clusters of size 2 each (6 sessions, 6 chunks, 3 distinct vector directions)
    for (let i = 0; i < 3; i++) {
      sessionRepo.upsert(makeSession(`sa${i}`));
      sessionRepo.upsert(makeSession(`sb${i}`));
      const v = new Float32Array(4);
      v[i] = 1; // orthogonal vectors — each pair clusters together
      const longText = `Cluster ${i} representative text that is certainly long enough for the filter`.padEnd(50);
      seedChunkAndEmbedding(chunkRepo, embeddingRepo, `ca${i}`, `sa${i}`, longText, v);
      seedChunkAndEmbedding(chunkRepo, embeddingRepo, `cb${i}`, `sb${i}`, longText, v);
    }

    const topics = computeTopics(db, MODEL, { limit: 2 });
    expect(topics.length).toBeLessThanOrEqual(2);
  });

  it("excludes chunks with text shorter than 40 chars", () => {
    sessionRepo.upsert(makeSession("s1"));
    sessionRepo.upsert(makeSession("s2"));

    const v = new Float32Array([1, 0, 0, 0]);
    // Short text — should be excluded from clustering
    chunkRepo.upsertMany([{ id: "cshort1", source_kind: "turn", source_id: "cshort1", session_id: "s1", position: 0, text: "short text", char_count: 10, created_at: Date.now() }]);
    chunkRepo.upsertMany([{ id: "cshort2", source_kind: "turn", source_id: "cshort2", session_id: "s2", position: 0, text: "short text", char_count: 10, created_at: Date.now() }]);
    embeddingRepo.upsertMany([{ chunk_id: "cshort1", model_name: MODEL, dim: 4, vector: v }]);
    embeddingRepo.upsertMany([{ chunk_id: "cshort2", model_name: MODEL, dim: 4, vector: v }]);

    const topics = computeTopics(db, MODEL);
    expect(topics).toEqual([]);
  });
});
