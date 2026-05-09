import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { scanSessionsIndex } from "../../src/scanner/sessionsIndex";

interface IndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime?: number;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  projectPath?: string;
  isSidechain?: boolean;
}

function writeIndex(
  tmpRoot: string,
  encodedDir: string,
  originalPath: string,
  entries: IndexEntry[],
): void {
  const dir = path.join(tmpRoot, encodedDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "sessions-index.json"),
    JSON.stringify({ version: 1, originalPath, entries }),
  );
}

describe("scanSessionsIndex", () => {
  let tmpRoot: string;
  let db: Db;
  let repo: SessionRepository;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sesh-ghost-"));
    db = openDb(":memory:");
    runMigrations(db);
    repo = new SessionRepository(db);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    db.close();
  });

  it("imports entries whose JSONL no longer exists as orphan rows", async () => {
    writeIndex(tmpRoot, "-tmp-proj", "/tmp/proj", [
      {
        sessionId: "ghost-1",
        fullPath: "/nonexistent/ghost-1.jsonl",
        firstPrompt: "explore the codebase",
        summary: "Code exploration session",
        messageCount: 12,
        created: "2026-04-01T10:00:00.000Z",
        modified: "2026-04-01T10:30:00.000Z",
        projectPath: "/tmp/proj",
      },
    ]);
    const result = await scanSessionsIndex(tmpRoot, repo);
    expect(result.imported).toBe(1);
    const row = repo.findById("ghost-1");
    expect(row).not.toBeNull();
    expect(row?.orphaned).toBe(1);
    expect(row?.auto_title).toBe("Code exploration session");
    expect(row?.message_count).toBe(12);
    expect(row?.project_path).toBe("/tmp/proj");
  });

  it("falls back to firstPrompt when no summary, stripping system tags", async () => {
    writeIndex(tmpRoot, "-tmp-proj", "/tmp/proj", [
      {
        sessionId: "ghost-2",
        fullPath: "/nonexistent/ghost-2.jsonl",
        firstPrompt:
          "<ide_opened_file>The user opened README.md</ide_opened_file>\n\nFix the typo",
        messageCount: 3,
        projectPath: "/tmp/proj",
      },
    ]);
    await scanSessionsIndex(tmpRoot, repo);
    const row = repo.findById("ghost-2");
    expect(row?.auto_title).toBe("Fix the typo");
  });

  it("skips entries whose JSONL still exists on disk", async () => {
    const dir = path.join(tmpRoot, "-tmp-proj");
    fs.mkdirSync(dir, { recursive: true });
    const realJsonl = path.join(dir, "real-session.jsonl");
    fs.writeFileSync(realJsonl, "{}");
    writeIndex(tmpRoot, "-tmp-proj", "/tmp/proj", [
      {
        sessionId: "real-session",
        fullPath: realJsonl,
        firstPrompt: "ignore me",
        projectPath: "/tmp/proj",
      },
    ]);
    const result = await scanSessionsIndex(tmpRoot, repo);
    expect(result.imported).toBe(0);
    expect(result.skippedExisting).toBe(1);
    expect(repo.findById("real-session")).toBeNull();
  });

  it("skips sidechain entries", async () => {
    writeIndex(tmpRoot, "-tmp-proj", "/tmp/proj", [
      {
        sessionId: "subagent-1",
        fullPath: "/nonexistent/sub.jsonl",
        firstPrompt: "subagent run",
        isSidechain: true,
      },
    ]);
    const result = await scanSessionsIndex(tmpRoot, repo);
    expect(result.imported).toBe(0);
    expect(result.skippedSidechain).toBe(1);
  });

  it("skips entries already present in DB (e.g., already scanned from JSONL)", async () => {
    repo.upsert({
      id: "already-here",
      source: "claude-code",
      project_path: "/tmp/proj",
      file_path: "/some/path",
      file_mtime: 0,
      file_size: 0,
      created_at: 0,
      last_active_at: 0,
      message_count: 0,
      auto_title: "from JSONL",
      custom_title: null,
      category_id: null,
      notes: null,
      favorited: 0,
      archived: 0,
      orphaned: 0,
      content_indexed: 0,
      last_parsed_offset: 0,
      tokens_in: 0,
      tokens_out: 0,
      tokens_cache_read: 0,
      tokens_cache_create: 0,
      turns_indexed: 0,
      turns_last_offset: 0,
      repo_path: null,
    });
    writeIndex(tmpRoot, "-tmp-proj", "/tmp/proj", [
      {
        sessionId: "already-here",
        fullPath: "/nonexistent/x.jsonl",
        summary: "should not overwrite",
      },
    ]);
    const result = await scanSessionsIndex(tmpRoot, repo);
    expect(result.imported).toBe(0);
    expect(result.skippedExisting).toBe(1);
    expect(repo.findById("already-here")?.auto_title).toBe("from JSONL");
    expect(repo.findById("already-here")?.orphaned).toBe(0);
  });
});
