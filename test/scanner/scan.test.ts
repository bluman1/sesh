import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { scanProjectsRoot } from "../../src/scanner/scan";

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
});
