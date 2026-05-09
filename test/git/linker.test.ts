import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { CommitRepository } from "../../src/db/commits";
import { SessionCommitRepository } from "../../src/db/sessionCommits";
import { TurnRepository } from "../../src/db/turns";
import { ToolCallRepository } from "../../src/db/toolCalls";
import { linkSessionsToCommits } from "../../src/git/linker";

const REPO = "/Users/m/proj";

function seedSession(db: Db, id: string, fileEdits: string[], created: number, lastActive: number) {
  const sessions = new SessionRepository(db);
  const turns = new TurnRepository(db);
  const toolCalls = new ToolCallRepository(db);
  sessions.upsert({
    id, source: "claude-code", project_path: REPO, file_path: `/p/${id}.jsonl`,
    file_mtime: 0, file_size: 0, created_at: created, last_active_at: lastActive,
    message_count: 1,
    auto_title: null, custom_title: null, category_id: null, notes: null,
    favorited: 0, archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
    tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
    turns_indexed: 1, turns_last_offset: 0, repo_path: REPO,
  });
  turns.upsertMany([{
    id: `${id}-a1`, session_id: id, seq: 0, role: "assistant",
    model: "claude-opus-4-7", ts: created + 1000,
    tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
    text_len: 0, latency_ms: null, is_correction: 0,
  }]);
  toolCalls.upsertMany(fileEdits.map((p, i) => ({
    id: `${id}-tc-${i}`,
    turn_id: `${id}-a1`,
    session_id: id,
    name: "Edit",
    target_path: `${REPO}/${p}`,
    is_error: 0,
    result_size: 0,
    ts: created + 1000,
  })));
}

function seedCommit(db: Db, sha: string, files: string[], authoredAt: number, message = "feat") {
  const commits = new CommitRepository(db);
  commits.upsertCommit({
    sha, repo_path: REPO, branch: "main",
    authored_at: authoredAt, author: "M", message,
  });
  commits.upsertFiles(files.map((p) => ({
    sha, path: p, status: "M", additions: 1, deletions: 0,
  })));
}

describe("linkSessionsToCommits", () => {
  let db: Db;
  let links: SessionCommitRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    links = new SessionCommitRepository(db);
  });

  it("links a session to a commit when files overlap exactly and time matches", () => {
    seedSession(db, "s1", ["src/a.ts"], 1000, 2000);
    seedCommit(db, "c1", ["src/a.ts"], 2500);
    linkSessionsToCommits(db, REPO);
    const linked = links.commitsForSession("s1");
    expect(linked.length).toBe(1);
    expect(linked[0].commit_sha).toBe("c1");
    expect(linked[0].confidence).toBeCloseTo(1.0);
  });

  it("does NOT link when there is zero file overlap", () => {
    seedSession(db, "s1", ["src/a.ts"], 1000, 2000);
    seedCommit(db, "c1", ["src/b.ts"], 2500);
    linkSessionsToCommits(db, REPO);
    expect(links.commitsForSession("s1")).toEqual([]);
  });

  it("scales confidence by jaccard for partial overlap", () => {
    seedSession(db, "s1", ["src/a.ts"], 1000, 2000);
    seedCommit(db, "c1", ["src/a.ts", "src/b.ts"], 2500);
    linkSessionsToCommits(db, REPO);
    const linked = links.commitsForSession("s1");
    expect(linked[0].confidence).toBeCloseTo(0.5);
  });

  it("decays confidence to 30% when time overlap is missing", () => {
    seedSession(db, "s1", ["src/a.ts"], 1000, 2000);
    seedCommit(db, "c1", ["src/a.ts"], 1_000_000_000); // far in the future
    linkSessionsToCommits(db, REPO);
    const linked = links.commitsForSession("s1");
    expect(linked.length).toBe(1);
    expect(linked[0].confidence).toBeCloseTo(0.3);
  });

  it("does NOT write a row below the 0.2 threshold", () => {
    seedSession(db, "s1", ["src/a.ts"], 1000, 2000);
    // commit touches 5 files, only 1 overlaps → 1/5 = 0.2 jaccard
    // time mismatch decays to 0.06 — below threshold
    seedCommit(db, "c1",
      ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"],
      1_000_000_000);
    linkSessionsToCommits(db, REPO);
    expect(links.commitsForSession("s1")).toEqual([]);
  });

  it("normalizes session tool_call paths against repo_path", () => {
    seedSession(db, "s1", ["nested/foo.ts"], 1000, 2000);
    seedCommit(db, "c1", ["nested/foo.ts"], 2500);
    linkSessionsToCommits(db, REPO);
    expect(links.commitsForSession("s1").length).toBe(1);
  });

  it("only links sessions in the given repo_path", () => {
    seedSession(db, "s1", ["src/a.ts"], 1000, 2000);
    seedCommit(db, "c1", ["src/a.ts"], 2500);
    // Commits in another repo
    new CommitRepository(db).upsertCommit({
      sha: "x1", repo_path: "/other/repo", branch: null,
      authored_at: 2500, author: null, message: null,
    });
    linkSessionsToCommits(db, REPO);
    expect(links.commitsForSession("s1").map((r) => r.commit_sha)).toEqual(["c1"]);
  });
});
