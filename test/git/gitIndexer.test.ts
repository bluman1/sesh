import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { CommitRepository } from "../../src/db/commits";
import { GitIndexer } from "../../src/git/gitIndexer";

let tmpRepo: string;

function commit(msg: string, files: { path: string; content: string }[]) {
  for (const f of files) {
    fs.writeFileSync(path.join(tmpRepo, f.path), f.content);
  }
  execFileSync("git", ["add", "."], { cwd: tmpRepo });
  execFileSync("git", ["commit", "-q", "-m", msg], { cwd: tmpRepo });
}

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "sesh-gitidx-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmpRepo });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: tmpRepo });
  execFileSync("git", ["config", "user.name", "Tester"], { cwd: tmpRepo });
  commit("first", [{ path: "a.txt", content: "hello\n" }]);
  commit("second", [
    { path: "a.txt", content: "hello\nworld\n" },
    { path: "b.txt", content: "new\n" },
  ]);
});

afterEach(() => {
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

describe("GitIndexer", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
  });

  it("indexes commits + files for a single repo", async () => {
    const sessions = new SessionRepository(db);
    const commits = new CommitRepository(db);
    sessions.upsert({
      id: "s1", source: "claude-code", project_path: tmpRepo, file_path: "/p/s1.jsonl",
      file_mtime: 0, file_size: 0, created_at: 0, last_active_at: 0, message_count: 0,
      auto_title: null, custom_title: null, category_id: null, notes: null,
      favorited: 0, archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
      turns_indexed: 0, turns_last_offset: 0, repo_path: tmpRepo,
    });
    const indexer = new GitIndexer(db, sessions, commits);
    await indexer.run();
    expect(commits.listForRepo(tmpRepo).length).toBeGreaterThanOrEqual(2);
    const latest = commits.listForRepo(tmpRepo)[0];
    expect(latest.message).toBe("second");
    expect(commits.listFiles(latest.sha).map((f) => f.path).sort()).toEqual([
      "a.txt", "b.txt",
    ].sort());
  });

  it("populates the branch field with the current branch", async () => {
    const sessions = new SessionRepository(db);
    const commits = new CommitRepository(db);
    sessions.upsert({
      id: "s1", source: "claude-code", project_path: tmpRepo, file_path: "/p/s1.jsonl",
      file_mtime: 0, file_size: 0, created_at: 0, last_active_at: 0, message_count: 0,
      auto_title: null, custom_title: null, category_id: null, notes: null,
      favorited: 0, archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
      turns_indexed: 0, turns_last_offset: 0, repo_path: tmpRepo,
    });
    const indexer = new GitIndexer(db, sessions, commits);
    await indexer.run();
    const all = commits.listForRepo(tmpRepo);
    expect(all[0].branch).toBe("main");
  });

  it("skips repos that don't exist on disk", async () => {
    const sessions = new SessionRepository(db);
    const commits = new CommitRepository(db);
    sessions.upsert({
      id: "s1", source: "claude-code", project_path: "/no/such/path",
      file_path: "/p/s1.jsonl", file_mtime: 0, file_size: 0, created_at: 0,
      last_active_at: 0, message_count: 0, auto_title: null, custom_title: null,
      category_id: null, notes: null, favorited: 0, archived: 0, orphaned: 0,
      content_indexed: 0, last_parsed_offset: 0, tokens_in: 0, tokens_out: 0,
      tokens_cache_read: 0, tokens_cache_create: 0, turns_indexed: 0,
      turns_last_offset: 0, repo_path: "/no/such/path",
    });
    const indexer = new GitIndexer(db, sessions, commits);
    await indexer.run();
    expect(commits.listForRepo("/no/such/path")).toEqual([]);
  });

  it("reports progress", async () => {
    const sessions = new SessionRepository(db);
    const commits = new CommitRepository(db);
    sessions.upsert({
      id: "s1", source: "claude-code", project_path: tmpRepo, file_path: "/p/s1.jsonl",
      file_mtime: 0, file_size: 0, created_at: 0, last_active_at: 0, message_count: 0,
      auto_title: null, custom_title: null, category_id: null, notes: null,
      favorited: 0, archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
      turns_indexed: 0, turns_last_offset: 0, repo_path: tmpRepo,
    });
    const indexer = new GitIndexer(db, sessions, commits);
    const events: { d: number; t: number }[] = [];
    indexer.setProgressHandler((d, t) => events.push({ d, t }));
    await indexer.run();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]).toEqual({ d: 1, t: 1 });
  });

  it("incremental run: second invocation only fetches commits since latest", async () => {
    const sessions = new SessionRepository(db);
    const commits = new CommitRepository(db);
    sessions.upsert({
      id: "s1", source: "claude-code", project_path: tmpRepo, file_path: "/p/s1.jsonl",
      file_mtime: 0, file_size: 0, created_at: 0, last_active_at: 0, message_count: 0,
      auto_title: null, custom_title: null, category_id: null, notes: null,
      favorited: 0, archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_create: 0,
      turns_indexed: 0, turns_last_offset: 0, repo_path: tmpRepo,
    });
    const indexer = new GitIndexer(db, sessions, commits);
    await indexer.run();
    const firstCount = commits.listForRepo(tmpRepo).length;
    // No new commits — re-running should not insert duplicates
    await indexer.run();
    expect(commits.listForRepo(tmpRepo).length).toBe(firstCount);
    // Add a new commit and re-run — should pick it up
    commit("third", [{ path: "c.txt", content: "newer\n" }]);
    await indexer.run();
    expect(commits.listForRepo(tmpRepo).length).toBe(firstCount + 1);
  });
});
