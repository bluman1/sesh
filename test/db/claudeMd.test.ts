import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import {
  ClaudeMdSuggestionRepository,
  type ClaudeMdSuggestionRow,
} from "../../src/db/claudeMd";

function makeSuggestion(overrides: Partial<ClaudeMdSuggestionRow> = {}): ClaudeMdSuggestionRow {
  return {
    id: "sug1",
    cluster_id: "cluster-a",
    body: "Always prefer editing files over creating new ones.",
    source_count: 5,
    detected_at: 1700000000000,
    status: "open",
    ...overrides,
  };
}

describe("ClaudeMdSuggestionRepository", () => {
  let db: Db;
  let repo: ClaudeMdSuggestionRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    repo = new ClaudeMdSuggestionRepository(db);
  });

  it("upsertMany inserts rows", () => {
    repo.upsertMany([makeSuggestion({ id: "sug1" }), makeSuggestion({ id: "sug2" })]);
    expect(repo.listOpen().length).toBe(2);
  });

  it("upsertMany is idempotent and updates body/source_count", () => {
    repo.upsertMany([makeSuggestion({ id: "sug1", body: "original", source_count: 3 })]);
    repo.upsertMany([makeSuggestion({ id: "sug1", body: "revised", source_count: 7 })]);
    const open = repo.listOpen();
    expect(open.length).toBe(1);
    expect(open[0].body).toBe("revised");
    expect(open[0].source_count).toBe(7);
  });

  it("listOpen excludes accepted and dismissed", () => {
    repo.upsertMany([
      makeSuggestion({ id: "sug1", status: "open" }),
      makeSuggestion({ id: "sug2", status: "accepted" }),
      makeSuggestion({ id: "sug3", status: "dismissed" }),
    ]);
    const open = repo.listOpen();
    expect(open.map((s) => s.id)).toEqual(["sug1"]);
  });

  it("listOpen orders by source_count DESC then detected_at DESC", () => {
    repo.upsertMany([
      makeSuggestion({ id: "sug1", source_count: 2, detected_at: 1000 }),
      makeSuggestion({ id: "sug2", source_count: 5, detected_at: 2000 }),
      makeSuggestion({ id: "sug3", source_count: 5, detected_at: 3000 }),
    ]);
    const ids = repo.listOpen().map((s) => s.id);
    // source_count 5 > 2; among the two with source_count=5, newer detected_at first
    expect(ids).toEqual(["sug3", "sug2", "sug1"]);
  });

  it("setStatus to accepted removes from listOpen", () => {
    repo.upsertMany([makeSuggestion({ id: "sug1", status: "open" })]);
    repo.setStatus("sug1", "accepted");
    expect(repo.listOpen()).toEqual([]);
  });

  it("setStatus to dismissed removes from listOpen", () => {
    repo.upsertMany([makeSuggestion({ id: "sug1", status: "open" })]);
    repo.setStatus("sug1", "dismissed");
    expect(repo.listOpen()).toEqual([]);
  });

  it("upsertMany with empty array does nothing", () => {
    repo.upsertMany([]);
    expect(repo.listOpen()).toEqual([]);
  });
});
