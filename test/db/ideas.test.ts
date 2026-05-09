import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { IdeaRepository, type IdeaRow } from "../../src/db/ideas";

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

function makeIdea(overrides: Partial<IdeaRow> = {}): IdeaRow {
  return {
    id: "i1",
    cluster_id: "cluster-a",
    text: "use a queue for background work",
    source_session_id: "s1",
    source_turn_id: null,
    detected_at: 1700000000000,
    confidence: 0.9,
    status: "open",
    ...overrides,
  };
}

describe("IdeaRepository", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let repo: IdeaRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    repo = new IdeaRepository(db);
    sessionRepo.upsert(makeSession("s1"));
  });

  it("upsertMany inserts rows", () => {
    repo.upsertMany([makeIdea({ id: "i1" }), makeIdea({ id: "i2" })]);
    expect(repo.listAll().length).toBe(2);
  });

  it("upsertMany is idempotent and updates text/confidence", () => {
    repo.upsertMany([makeIdea({ id: "i1", text: "original", confidence: 0.5 })]);
    repo.upsertMany([makeIdea({ id: "i1", text: "updated", confidence: 0.95 })]);
    const all = repo.listAll();
    expect(all.length).toBe(1);
    expect(all[0].text).toBe("updated");
    expect(all[0].confidence).toBeCloseTo(0.95, 5);
  });

  it("listActive excludes non-open statuses", () => {
    repo.upsertMany([
      makeIdea({ id: "i1", status: "open" }),
      makeIdea({ id: "i2", status: "dismissed" }),
      makeIdea({ id: "i3", status: "done" }),
      makeIdea({ id: "i4", status: "scheduled" }),
    ]);
    const active = repo.listActive();
    expect(active.map((i) => i.id)).toEqual(["i1"]);
  });

  it("listAll returns all regardless of status ordered by detected_at DESC", () => {
    repo.upsertMany([
      makeIdea({ id: "i1", detected_at: 1000, status: "open" }),
      makeIdea({ id: "i2", detected_at: 3000, status: "dismissed" }),
      makeIdea({ id: "i3", detected_at: 2000, status: "done" }),
    ]);
    expect(repo.listAll().map((i) => i.id)).toEqual(["i2", "i3", "i1"]);
  });

  it("setStatus changes status", () => {
    repo.upsertMany([makeIdea({ id: "i1", status: "open" })]);
    repo.setStatus("i1", "dismissed");
    expect(repo.listAll()[0].status).toBe("dismissed");
  });

  it("setStatus dismissed removes from listActive", () => {
    repo.upsertMany([makeIdea({ id: "i1", status: "open" })]);
    repo.setStatus("i1", "dismissed");
    expect(repo.listActive()).toEqual([]);
  });

  it("listClusters groups by cluster_id and sorts by size DESC", () => {
    repo.upsertMany([
      makeIdea({ id: "i1", cluster_id: "cluster-a", status: "open" }),
      makeIdea({ id: "i2", cluster_id: "cluster-b", status: "open" }),
      makeIdea({ id: "i3", cluster_id: "cluster-a", status: "open" }),
      makeIdea({ id: "i4", cluster_id: "cluster-b", status: "open" }),
      makeIdea({ id: "i5", cluster_id: "cluster-b", status: "open" }),
    ]);
    const clusters = repo.listClusters();
    expect(clusters[0].cluster_id).toBe("cluster-b");
    expect(clusters[0].size).toBe(3);
    expect(clusters[1].cluster_id).toBe("cluster-a");
    expect(clusters[1].size).toBe(2);
  });

  it("listClusters excludes dismissed ideas", () => {
    repo.upsertMany([
      makeIdea({ id: "i1", cluster_id: "cluster-a", status: "open" }),
      makeIdea({ id: "i2", cluster_id: "cluster-a", status: "dismissed" }),
    ]);
    const clusters = repo.listClusters();
    expect(clusters.length).toBe(1);
    expect(clusters[0].size).toBe(1);
  });

  it("upsertMany with empty array does nothing", () => {
    repo.upsertMany([]);
    expect(repo.listAll()).toEqual([]);
  });

  it("source_turn_id can be null", () => {
    repo.upsertMany([makeIdea({ id: "i1", source_turn_id: null })]);
    expect(repo.listAll()[0].source_turn_id).toBeNull();
  });
});
