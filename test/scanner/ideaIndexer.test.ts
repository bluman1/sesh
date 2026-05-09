import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { ChunkRepository } from "../../src/db/chunks";
import { IdeaRepository } from "../../src/db/ideas";
import { IdeaIndexer } from "../../src/scanner/ideaIndexer";
import type { Embedder } from "../../src/embed/types";

class FakeEmbedder implements Embedder {
  readonly modelName = "fake";
  readonly dim = 4;
  async embed(texts: string[]): Promise<Float32Array[]> {
    // Make texts containing the same content word produce similar vectors.
    return texts.map((t) => {
      const v = new Float32Array(4);
      v[0] = t.toLowerCase().includes("refactor") ? 1 : 0;
      v[1] = t.toLowerCase().includes("auth") ? 1 : 0;
      v[2] = t.toLowerCase().includes("test") ? 1 : 0;
      v[3] = t.length / 100;
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

describe("IdeaIndexer", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let chunkRepo: ChunkRepository;
  let ideaRepo: IdeaRepository;
  let embedder: FakeEmbedder;
  let indexer: IdeaIndexer;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    chunkRepo = new ChunkRepository(db);
    ideaRepo = new IdeaRepository(db);
    embedder = new FakeEmbedder();
    indexer = new IdeaIndexer(
      ideaRepo,
      chunkRepo,
      embedder,
      30,
    );

    // Seed sessions.
    sessionRepo.upsert(makeSession("s1"));
    sessionRepo.upsert(makeSession("s2"));

    const now = Date.now();

    // Seed user_msg chunks with intent phrases.
    chunkRepo.upsertMany([
      {
        id: "c1",
        source_kind: "user_msg",
        source_id: "turn1",
        session_id: "s1",
        position: 0,
        text: "I should refactor the auth module to be more modular.",
        char_count: 52,
        created_at: now,
      },
      {
        id: "c2",
        source_kind: "user_msg",
        source_id: "turn2",
        session_id: "s2",
        position: 0,
        text: "I will refactor the auth module before the release.",
        char_count: 51,
        created_at: now,
      },
      {
        id: "c3",
        source_kind: "user_msg",
        source_id: "turn3",
        session_id: "s1",
        position: 1,
        text: "We are happy with the current state of things here.",
        char_count: 51,
        created_at: now,
      },
    ]);
  });

  it("detects at least 2 ideas from the seeded chunks", async () => {
    await indexer.run();
    const ideas = ideaRepo.listAll();
    expect(ideas.length).toBeGreaterThanOrEqual(2);
  });

  it("clusters the two refactor mentions together", async () => {
    await indexer.run();
    const ideas = ideaRepo.listAll();
    const refactorIdeas = ideas.filter((i) => i.text.toLowerCase().includes("refactor"));
    expect(refactorIdeas.length).toBeGreaterThanOrEqual(2);
    // Both refactor ideas should share the same cluster_id.
    const clusterIds = new Set(refactorIdeas.map((i) => i.cluster_id));
    expect(clusterIds.size).toBe(1);
  });

  it("does not persist the non-intent sentence", async () => {
    await indexer.run();
    const ideas = ideaRepo.listAll();
    const happyIdeas = ideas.filter((i) => i.text.toLowerCase().includes("happy"));
    expect(happyIdeas).toHaveLength(0);
  });

  it("re-running is idempotent — does not duplicate ideas", async () => {
    await indexer.run();
    const countAfterFirst = ideaRepo.listAll().length;
    await indexer.run();
    expect(ideaRepo.listAll().length).toBe(countAfterFirst);
  });

  it("returns early when no user_msg chunks exist", async () => {
    // Override with a non-user_msg chunk only.
    db.prepare("DELETE FROM chunks").run();
    chunkRepo.upsertMany([
      {
        id: "c-assistant",
        source_kind: "turn",
        source_id: "turn-a",
        session_id: "s1",
        position: 0,
        text: "I should help with that refactoring task for the auth module.",
        char_count: 62,
        created_at: Date.now(),
      },
    ]);
    await indexer.run();
    expect(ideaRepo.listAll()).toHaveLength(0);
  });

  it("skips chunks older than sinceDays", async () => {
    db.prepare("DELETE FROM chunks").run();
    const oldTs = Date.now() - 31 * 86400 * 1000;
    chunkRepo.upsertMany([
      {
        id: "cold",
        source_kind: "user_msg",
        source_id: "turn-old",
        session_id: "s1",
        position: 0,
        text: "I should refactor the auth module in this old session.",
        char_count: 54,
        created_at: oldTs,
      },
    ]);
    await indexer.run();
    expect(ideaRepo.listAll()).toHaveLength(0);
  });
});
