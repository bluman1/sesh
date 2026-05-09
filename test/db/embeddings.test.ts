import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { ChunkRepository } from "../../src/db/chunks";
import {
  EmbeddingRepository,
  packVector,
  unpackVector,
} from "../../src/db/embeddings";

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

function seedChunk(chunkRepo: ChunkRepository, id: string, sessionId = "s1") {
  chunkRepo.upsertMany([
    {
      id,
      source_kind: "turn",
      source_id: id,
      session_id: sessionId,
      position: 0,
      text: "some text",
      char_count: 9,
      created_at: 1700000000000,
    },
  ]);
}

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("packVector / unpackVector", () => {
  it("round-trips a Float32Array preserving byte values", () => {
    const original = vec([1.5, -2.25, 0.0, 3.14]);
    const packed = packVector(original);
    const unpacked = unpackVector(packed, 4);
    expect(unpacked.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(unpacked[i]).toBeCloseTo(original[i], 5);
    }
  });

  it("returns an independent copy (modifying unpacked doesn't affect re-unpack)", () => {
    const original = vec([1.0, 2.0, 3.0, 4.0]);
    const packed = packVector(original);
    const first = unpackVector(packed, 4);
    first[0] = 999;
    const second = unpackVector(packed, 4);
    expect(second[0]).toBeCloseTo(1.0, 5);
  });
});

describe("EmbeddingRepository", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let chunkRepo: ChunkRepository;
  let repo: EmbeddingRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    chunkRepo = new ChunkRepository(db);
    repo = new EmbeddingRepository(db);
    sessionRepo.upsert(makeSession("s1"));
  });

  it("upsertMany stores and listAll retrieves vectors", () => {
    seedChunk(chunkRepo, "c1");
    repo.upsertMany([
      { chunk_id: "c1", model_name: "minilm", dim: 4, vector: vec([1, 2, 3, 4]) },
    ]);
    const results = repo.listAll("minilm");
    expect(results.length).toBe(1);
    expect(results[0].chunk_id).toBe("c1");
    expect(Array.from(results[0].vector)).toEqual([1, 2, 3, 4]);
  });

  it("upsertMany is idempotent — re-upsert updates vector", () => {
    seedChunk(chunkRepo, "c1");
    repo.upsertMany([
      { chunk_id: "c1", model_name: "minilm", dim: 4, vector: vec([1, 2, 3, 4]) },
    ]);
    repo.upsertMany([
      { chunk_id: "c1", model_name: "minilm", dim: 4, vector: vec([9, 8, 7, 6]) },
    ]);
    const results = repo.listAll("minilm");
    expect(results.length).toBe(1);
    expect(Array.from(results[0].vector)).toEqual([9, 8, 7, 6]);
  });

  it("listAll is scoped by model_name", () => {
    seedChunk(chunkRepo, "c1");
    repo.upsertMany([
      { chunk_id: "c1", model_name: "minilm", dim: 4, vector: vec([1, 2, 3, 4]) },
      { chunk_id: "c1", model_name: "ada-002", dim: 4, vector: vec([5, 6, 7, 8]) },
    ]);
    const minilm = repo.listAll("minilm");
    const ada = repo.listAll("ada-002");
    expect(minilm.length).toBe(1);
    expect(ada.length).toBe(1);
    expect(Array.from(minilm[0].vector)).toEqual([1, 2, 3, 4]);
    expect(Array.from(ada[0].vector)).toEqual([5, 6, 7, 8]);
  });

  it("upsertMany with empty array does nothing", () => {
    repo.upsertMany([]);
    expect(repo.listAll("minilm")).toEqual([]);
  });

  it("listChunkIdsMissing returns chunks without embeddings for a model", () => {
    seedChunk(chunkRepo, "c1");
    seedChunk(chunkRepo, "c2");
    repo.upsertMany([
      { chunk_id: "c1", model_name: "minilm", dim: 4, vector: vec([1, 2, 3, 4]) },
    ]);
    const missing = repo.listChunkIdsMissing("minilm");
    expect(missing).toEqual(["c2"]);
  });

  it("listChunkIdsMissing with sessionId scopes to that session", () => {
    sessionRepo.upsert(makeSession("s2"));
    seedChunk(chunkRepo, "c1", "s1");
    seedChunk(chunkRepo, "c2", "s2");
    // c1 has an embedding; c2 does not
    repo.upsertMany([
      { chunk_id: "c1", model_name: "minilm", dim: 4, vector: vec([1, 2, 3, 4]) },
    ]);
    const missingSes1 = repo.listChunkIdsMissing("minilm", "s1");
    const missingSes2 = repo.listChunkIdsMissing("minilm", "s2");
    // s1's c1 has embedding — nothing missing
    expect(missingSes1).toEqual([]);
    // s2's c2 has no embedding
    expect(missingSes2).toEqual(["c2"]);
  });

  it("deleteForChunk removes embeddings for that chunk", () => {
    seedChunk(chunkRepo, "c1");
    repo.upsertMany([
      { chunk_id: "c1", model_name: "minilm", dim: 4, vector: vec([1, 2, 3, 4]) },
    ]);
    repo.deleteForChunk("c1");
    expect(repo.listAll("minilm")).toEqual([]);
  });
});
