import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { CommitRepository } from "../../src/db/commits";
import { SessionCommitRepository } from "../../src/db/sessionCommits";

function seed(db: Db) {
  const sessions = new SessionRepository(db);
  const commits = new CommitRepository(db);
  sessions.upsert({
    id: "s1", source: "claude-code", project_path: "/p", file_path: "/p/s1.jsonl",
    file_mtime: 0, file_size: 0, created_at: 0, last_active_at: 0, message_count: 0,
    auto_title: null, custom_title: null, category_id: null, notes: null,
    favorited: 0, archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
    tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
    turns_indexed: 0, turns_last_offset: 0, repo_path: "/p",
  });
  commits.upsertCommit({
    sha: "c1", repo_path: "/p", branch: "main",
    authored_at: 1000, author: "M", message: "feat",
  });
}

describe("SessionCommitRepository", () => {
  let db: Db;
  let repo: SessionCommitRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    seed(db);
    repo = new SessionCommitRepository(db);
  });

  it("upsertMany inserts links", () => {
    repo.upsertMany([{ session_id: "s1", commit_sha: "c1", confidence: 0.7 }]);
    expect(repo.commitsForSession("s1").map((r) => r.commit_sha)).toEqual(["c1"]);
  });

  it("upsertMany updates confidence on conflict", () => {
    repo.upsertMany([{ session_id: "s1", commit_sha: "c1", confidence: 0.3 }]);
    repo.upsertMany([{ session_id: "s1", commit_sha: "c1", confidence: 0.8 }]);
    expect(repo.commitsForSession("s1")[0].confidence).toBe(0.8);
  });

  it("commitsForSession orders by confidence DESC", () => {
    const commits = new CommitRepository(db);
    commits.upsertCommit({
      sha: "c2", repo_path: "/p", branch: null,
      authored_at: 2000, author: null, message: null,
    });
    repo.upsertMany([
      { session_id: "s1", commit_sha: "c1", confidence: 0.4 },
      { session_id: "s1", commit_sha: "c2", confidence: 0.9 },
    ]);
    expect(repo.commitsForSession("s1").map((r) => r.commit_sha)).toEqual(["c2", "c1"]);
  });

  it("sessionsForCommit returns linked sessions", () => {
    repo.upsertMany([{ session_id: "s1", commit_sha: "c1", confidence: 0.5 }]);
    expect(repo.sessionsForCommit("c1").map((r) => r.session_id)).toEqual(["s1"]);
  });

  it("deleteForSession removes that session's links", () => {
    repo.upsertMany([{ session_id: "s1", commit_sha: "c1", confidence: 0.5 }]);
    repo.deleteForSession("s1");
    expect(repo.commitsForSession("s1")).toEqual([]);
  });

  it("topConfidenceForSession returns highest-confidence link or null", () => {
    expect(repo.topConfidenceForSession("s1")).toBeNull();
    repo.upsertMany([{ session_id: "s1", commit_sha: "c1", confidence: 0.6 }]);
    expect(repo.topConfidenceForSession("s1")).toBe(0.6);
  });
});
