import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { OutcomeRepository } from "../../src/db/outcomes";
import { inferOutcomes } from "../../src/scanner/outcomeInferer";
import { CommitRepository } from "../../src/db/commits";
import { SessionCommitRepository } from "../../src/db/sessionCommits";

describe("inferOutcomes", () => {
  let db: Db;
  let sessions: SessionRepository;
  let outcomes: OutcomeRepository;
  const NOW = 1700000000000;
  const DAY = 86400 * 1000;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessions = new SessionRepository(db);
    outcomes = new OutcomeRepository(db);
  });

  function fakeSession(id: string, lastActive: number, repoPath: string | null = "/p") {
    sessions.upsert({
      id, source: "claude-code", project_path: "/p", file_path: `/p/${id}.jsonl`,
      file_mtime: 0, file_size: 0, created_at: lastActive - 1000, last_active_at: lastActive,
      message_count: 1,
      auto_title: null, custom_title: null, category_id: null, notes: null,
      favorited: 0, archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
      turns_indexed: 0, turns_last_offset: 0, repo_path: repoPath,
    });
  }

  it("flags >30d inactive sessions as 'abandoned'", () => {
    fakeSession("s-old", NOW - 31 * DAY);
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-old")?.state).toBe("abandoned");
  });

  it("flags <30d inactive sessions as 'open'", () => {
    fakeSession("s-fresh", NOW - 5 * DAY);
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-fresh")?.state).toBe("open");
  });

  it("does not overwrite user-marked outcomes", () => {
    fakeSession("s-pinned", NOW - 60 * DAY);
    outcomes.setUser("s-pinned", "shipped", "I shipped this manually");
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-pinned")?.state).toBe("shipped");
  });

  it("respects custom windowDays", () => {
    fakeSession("s-week", NOW - 8 * DAY);
    inferOutcomes({ db, now: NOW, windowDays: 7 });
    expect(outcomes.getForSession("s-week")?.state).toBe("abandoned");
  });

  it("flags 'shipped' when a session has a linked commit with confidence >= 0.5", () => {
    fakeSession("s-shipped", NOW - 5 * DAY);
    const commits = new CommitRepository(db);
    commits.upsertCommit({
      sha: "c1", repo_path: "/p", branch: "main",
      authored_at: NOW - 5 * DAY, author: null, message: "feat",
    });
    new SessionCommitRepository(db).upsertMany([{
      session_id: "s-shipped", commit_sha: "c1", confidence: 0.7,
    }]);
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-shipped")?.state).toBe("shipped");
  });

  it("flags 'shipped-partial' when confidence is between 0.2 and 0.5", () => {
    fakeSession("s-partial", NOW - 5 * DAY);
    const commits = new CommitRepository(db);
    commits.upsertCommit({
      sha: "c1", repo_path: "/p", branch: "main",
      authored_at: NOW - 5 * DAY, author: null, message: "feat",
    });
    new SessionCommitRepository(db).upsertMany([{
      session_id: "s-partial", commit_sha: "c1", confidence: 0.3,
    }]);
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-partial")?.state).toBe("shipped-partial");
  });

  it("flags 'reverted' when a commit titled Revert touches a session's files", () => {
    fakeSession("s-rev", NOW - 5 * DAY);
    const commits = new CommitRepository(db);
    commits.upsertCommit({
      sha: "c1", repo_path: "/p", branch: "main",
      authored_at: NOW - 5 * DAY, author: null, message: "feat",
    });
    commits.upsertCommit({
      sha: "c2", repo_path: "/p", branch: "main",
      authored_at: NOW - 4 * DAY, author: null,
      message: "Revert \"feat\"",
    });
    commits.upsertFiles([
      { sha: "c1", path: "src/a.ts", status: "A", additions: 5, deletions: 0 },
      { sha: "c2", path: "src/a.ts", status: "M", additions: 0, deletions: 5 },
    ]);
    new SessionCommitRepository(db).upsertMany([{
      session_id: "s-rev", commit_sha: "c1", confidence: 0.7,
    }]);
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-rev")?.state).toBe("reverted");
  });

  it("git-derived state takes precedence over age-based 'abandoned'", () => {
    fakeSession("s-old-shipped", NOW - 60 * DAY);
    const commits = new CommitRepository(db);
    commits.upsertCommit({
      sha: "c1", repo_path: "/p", branch: "main",
      authored_at: NOW - 60 * DAY, author: null, message: "feat",
    });
    new SessionCommitRepository(db).upsertMany([{
      session_id: "s-old-shipped", commit_sha: "c1", confidence: 0.8,
    }]);
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-old-shipped")?.state).toBe("shipped");
  });

  it("falls back to age-based when no git linkage exists", () => {
    fakeSession("s-no-git", NOW - 60 * DAY);
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-no-git")?.state).toBe("abandoned");
  });

  it("user-marked outcomes still win over git-derived state", () => {
    fakeSession("s-pinned", NOW - 5 * DAY);
    outcomes.setUser("s-pinned", "open", "I'm still working on this");
    const commits = new CommitRepository(db);
    commits.upsertCommit({
      sha: "c1", repo_path: "/p", branch: "main",
      authored_at: NOW - 5 * DAY, author: null, message: "feat",
    });
    new SessionCommitRepository(db).upsertMany([{
      session_id: "s-pinned", commit_sha: "c1", confidence: 0.9,
    }]);
    inferOutcomes({ db, now: NOW, windowDays: 30 });
    expect(outcomes.getForSession("s-pinned")?.state).toBe("open");
  });
});
