import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import {
  CommitRepository,
  type CommitRow,
  type CommitFileRow,
} from "../../src/db/commits";

function makeCommit(overrides: Partial<CommitRow> = {}): CommitRow {
  return {
    sha: "abc123",
    repo_path: "/Users/m/proj",
    branch: "main",
    authored_at: 1700000000000,
    author: "Michael",
    message: "feat: add thing",
    ...overrides,
  };
}

function makeCommitFile(overrides: Partial<CommitFileRow> = {}): CommitFileRow {
  return {
    sha: "abc123",
    path: "src/foo.ts",
    status: "M",
    additions: 5,
    deletions: 2,
    ...overrides,
  };
}

describe("CommitRepository", () => {
  let db: Db;
  let repo: CommitRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    repo = new CommitRepository(db);
  });

  it("upsertCommit and findBySha", () => {
    repo.upsertCommit(makeCommit());
    expect(repo.findBySha("abc123")?.message).toBe("feat: add thing");
  });

  it("upsertCommit is idempotent", () => {
    repo.upsertCommit(makeCommit());
    repo.upsertCommit(makeCommit({ message: "feat: updated" }));
    expect(repo.findBySha("abc123")?.message).toBe("feat: updated");
  });

  it("upsertFiles inserts batch and replaces on re-upsert", () => {
    repo.upsertCommit(makeCommit());
    repo.upsertFiles([
      makeCommitFile({ path: "src/a.ts" }),
      makeCommitFile({ path: "src/b.ts" }),
    ]);
    expect(repo.listFiles("abc123").length).toBe(2);
    repo.upsertFiles([makeCommitFile({ path: "src/a.ts", additions: 99 })]);
    const files = repo.listFiles("abc123");
    expect(files.find((f) => f.path === "src/a.ts")?.additions).toBe(99);
  });

  it("listForRepo orders by authored_at DESC", () => {
    repo.upsertCommit(makeCommit({ sha: "old", authored_at: 100 }));
    repo.upsertCommit(makeCommit({ sha: "new", authored_at: 200 }));
    expect(repo.listForRepo("/Users/m/proj").map((c) => c.sha)).toEqual(["new", "old"]);
  });

  it("listForRepoSince filters by authored_at >= since", () => {
    repo.upsertCommit(makeCommit({ sha: "old", authored_at: 100 }));
    repo.upsertCommit(makeCommit({ sha: "new", authored_at: 200 }));
    const result = repo.listForRepoSince("/Users/m/proj", 150);
    expect(result.map((c) => c.sha)).toEqual(["new"]);
  });

  it("latestCommitTimestampForRepo returns max authored_at or null", () => {
    expect(repo.latestCommitTimestampForRepo("/Users/m/proj")).toBeNull();
    repo.upsertCommit(makeCommit({ sha: "a", authored_at: 100 }));
    repo.upsertCommit(makeCommit({ sha: "b", authored_at: 200 }));
    expect(repo.latestCommitTimestampForRepo("/Users/m/proj")).toBe(200);
  });

  it("deleteForRepo cascades to commit_files via FK", () => {
    repo.upsertCommit(makeCommit({ sha: "a" }));
    repo.upsertFiles([makeCommitFile({ sha: "a" })]);
    repo.deleteForRepo("/Users/m/proj");
    expect(repo.findBySha("a")).toBeNull();
    expect(repo.listFiles("a")).toEqual([]);
  });
});
