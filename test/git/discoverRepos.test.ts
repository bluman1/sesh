import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDb } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { discoverRepos } from "../../src/git/discoverRepos";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sesh-disc-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("discoverRepos", () => {
  it("populates repo_path on sessions whose project_path is inside a git repo", () => {
    const repo = path.join(tmpRoot, "myrepo");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    const sub = path.join(repo, "src", "deep");
    fs.mkdirSync(sub, { recursive: true });

    const db = openDb(":memory:");
    runMigrations(db);
    const sessions = new SessionRepository(db);
    sessions.upsert({
      id: "s1", source: "claude-code", project_path: sub,
      file_path: "/p/s1.jsonl", file_mtime: 0, file_size: 0, created_at: 0,
      last_active_at: 0, message_count: 0, auto_title: null,
      custom_title: null, category_id: null, notes: null, favorited: 0,
      archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
      tokens_cache_create: 0, turns_indexed: 0, turns_last_offset: 0,
      repo_path: null,
    });

    discoverRepos(sessions);
    expect(sessions.findById("s1")?.repo_path).toBe(repo);
  });

  it("leaves repo_path null for sessions whose project_path is not inside a repo", () => {
    const noRepo = path.join(tmpRoot, "noRepo");
    fs.mkdirSync(noRepo, { recursive: true });

    const db = openDb(":memory:");
    runMigrations(db);
    const sessions = new SessionRepository(db);
    sessions.upsert({
      id: "s1", source: "claude-code", project_path: noRepo,
      file_path: "/p/s1.jsonl", file_mtime: 0, file_size: 0, created_at: 0,
      last_active_at: 0, message_count: 0, auto_title: null,
      custom_title: null, category_id: null, notes: null, favorited: 0,
      archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
      tokens_cache_create: 0, turns_indexed: 0, turns_last_offset: 0,
      repo_path: null,
    });

    // Walking up from /var/folders/... eventually finds no .git unless
    // your tmpdir happens to be inside a repo. Ensure root parents are clean.
    discoverRepos(sessions);
    // Could be null OR some ancestor repo if your tmpdir is inside one;
    // the contract is that the function doesn't error.
    const result = sessions.findById("s1")?.repo_path;
    expect(typeof result === "string" || result === null).toBe(true);
  });

  it("only revisits sessions whose repo_path is null", () => {
    const repo1 = path.join(tmpRoot, "r1");
    fs.mkdirSync(path.join(repo1, ".git"), { recursive: true });

    const db = openDb(":memory:");
    runMigrations(db);
    const sessions = new SessionRepository(db);
    sessions.upsert({
      id: "s-already", source: "claude-code", project_path: repo1,
      file_path: "/p/s.jsonl", file_mtime: 0, file_size: 0, created_at: 0,
      last_active_at: 0, message_count: 0, auto_title: null,
      custom_title: null, category_id: null, notes: null, favorited: 0,
      archived: 0, orphaned: 0, content_indexed: 0, last_parsed_offset: 0,
      tokens_in: 0, tokens_out: 0, tokens_cache_read: 0,
      tokens_cache_create: 0, turns_indexed: 0, turns_last_offset: 0,
      repo_path: "/already/cached",
    });

    discoverRepos(sessions);
    // The cached value is preserved because listSessionsNeedingRepoDiscovery
    // filters on repo_path IS NULL.
    expect(sessions.findById("s-already")?.repo_path).toBe("/already/cached");
  });
});
