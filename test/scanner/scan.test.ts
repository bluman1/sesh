import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { scanProjectsRoot } from "../../src/scanner/scan";
import { SESH_META_CWD } from "../../src/host/seshPaths";

const SAMPLE_FIXTURE = path.join(__dirname, "..", "fixtures", "sample.jsonl");

describe("scanProjectsRoot", () => {
  let tmpRoot: string;
  let db: Db;
  let repo: SessionRepository;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sesh-scan-"));
    fs.mkdirSync(path.join(tmpRoot, "-tmp-proj"));
    fs.copyFileSync(
      SAMPLE_FIXTURE,
      path.join(tmpRoot, "-tmp-proj", "sample-id.jsonl"),
    );
    db = openDb(":memory:");
    runMigrations(db);
    repo = new SessionRepository(db);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("scans .jsonl files and upserts session rows", async () => {
    const result = await scanProjectsRoot(tmpRoot, repo);
    expect(result.scanned).toBe(1);
    expect(result.upserted).toBe(1);
    const found = repo.findById("sample-id");
    expect(found?.project_path).toBe("/tmp/proj");
    expect(found?.auto_title).toBe("first prompt");
  });

  it("skips files unchanged since last scan (mtime + size match)", async () => {
    const first = await scanProjectsRoot(tmpRoot, repo);
    expect(first.upserted).toBe(1);
    const second = await scanProjectsRoot(tmpRoot, repo);
    expect(second.scanned).toBe(1);
    expect(second.upserted).toBe(0);
  });

  it("re-upserts when size differs even if mtime matches", async () => {
    const first = await scanProjectsRoot(tmpRoot, repo);
    expect(first.upserted).toBe(1);

    // Simulate a backup/restore scenario: same mtime, different size.
    // Patch the persisted row so file_mtime still matches the on-disk mtime
    // exactly, but file_size is stale. The scanner must NOT skip in that case.
    const filePath = path.join(tmpRoot, "-tmp-proj", "sample-id.jsonl");
    const stat = fs.statSync(filePath);
    db.prepare("UPDATE sessions SET file_size = ? WHERE id = ?").run(
      stat.size + 999,
      "sample-id",
    );
    const before = repo.getFileStat("sample-id");
    expect(before).not.toBeNull();
    expect(before!.mtime).toBe(stat.mtimeMs);
    expect(before!.size).not.toBe(stat.size);

    const second = await scanProjectsRoot(tmpRoot, repo);
    expect(second.scanned).toBe(1);
    expect(second.upserted).toBe(1);
    expect(second.skipped).toBe(0);
    expect(repo.getFileStat("sample-id")?.size).toBe(stat.size);
  });

  it("does not throw when a .jsonl entry is a broken symlink", async () => {
    fs.symlinkSync(
      "/nonexistent-sesh-target",
      path.join(tmpRoot, "-tmp-proj", "ghost-id.jsonl"),
    );
    const result = await scanProjectsRoot(tmpRoot, repo);
    // The real sample is still scanned/upserted; the ghost is silently skipped.
    expect(result.scanned).toBe(1);
    expect(result.upserted).toBe(1);
    expect(repo.findById("ghost-id")).toBeNull();
  });

  it("filters out sessions whose cwd matches SESH_META_CWD", async () => {
    // Synthesize a JSONL whose first record reports cwd = SESH_META_CWD.
    // These are produced by Sesh's own title-generator CLI calls and must
    // never surface in the user's session list.
    const dirName = "-Users-fake-.sesh-cli";
    fs.mkdirSync(path.join(tmpRoot, dirName));
    const jsonl = JSON.stringify({
      type: "user",
      cwd: SESH_META_CWD,
      message: { role: "user", content: "Generate a title for this conversation" },
      uuid: "u1",
      timestamp: "2026-04-22T10:00:00.000Z",
    });
    fs.writeFileSync(
      path.join(tmpRoot, dirName, "sesh-meta-id.jsonl"),
      jsonl + "\n",
    );

    const result = await scanProjectsRoot(tmpRoot, repo);
    // The legitimate sample under -tmp-proj is upserted; the meta-cwd one
    // is counted as scanned but skipped (no upsert).
    expect(result.scanned).toBe(2);
    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(repo.findById("sample-id")).not.toBeNull();
    expect(repo.findById("sesh-meta-id")).toBeNull();
  });
});
