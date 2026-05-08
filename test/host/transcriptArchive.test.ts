import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { TranscriptArchive } from "../../src/host/transcriptArchive";

describe("TranscriptArchive", () => {
  let tmpDir: string;
  let sourceDir: string;
  let archive: TranscriptArchive;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sesh-archive-"));
    sourceDir = path.join(tmpDir, "src");
    fs.mkdirSync(sourceDir);
    archive = new TranscriptArchive(path.join(tmpDir, "archive"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("archive() writes a gzipped copy that recovers the original content", async () => {
    const src = path.join(sourceDir, "session.jsonl");
    const content = '{"a":1}\n{"b":2}\n{"c":3}\n';
    fs.writeFileSync(src, content);

    await archive.archive(src, "abc-123");

    expect(archive.has("abc-123")).toBe(true);
    const compressed = fs.readFileSync(archive.pathFor("abc-123"));
    const decompressed = zlib.gunzipSync(compressed).toString("utf-8");
    expect(decompressed).toBe(content);
  });

  it("archive() is atomic — no .tmp file left behind", async () => {
    const src = path.join(sourceDir, "session.jsonl");
    fs.writeFileSync(src, "x");
    await archive.archive(src, "id-1");
    const entries = fs.readdirSync(path.join(tmpDir, "archive"));
    expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
  });

  it("archiveIfNeeded() skips when archive is up to date", async () => {
    const src = path.join(sourceDir, "session.jsonl");
    fs.writeFileSync(src, "first");
    await archive.archive(src, "skip-id");

    const wrote = await archive.archiveIfNeeded(src, "skip-id");
    expect(wrote).toBe(false);
  });

  it("archiveIfNeeded() re-archives when the source is newer", async () => {
    const src = path.join(sourceDir, "session.jsonl");
    fs.writeFileSync(src, "v1");
    await archive.archive(src, "newer-id");

    // Bump source mtime forward
    const future = new Date(Date.now() + 60_000);
    await fsp.utimes(src, future, future);
    fs.writeFileSync(src, "v2");
    // setting mtime explicitly because writeFileSync may race
    await fsp.utimes(src, future, future);

    const wrote = await archive.archiveIfNeeded(src, "newer-id");
    expect(wrote).toBe(true);

    const decompressed = zlib
      .gunzipSync(fs.readFileSync(archive.pathFor("newer-id")))
      .toString("utf-8");
    expect(decompressed).toBe("v2");
  });

  it("size() reports zero when nothing has been archived", async () => {
    const result = await archive.size();
    expect(result).toEqual({ files: 0, bytes: 0 });
  });

  it("size() counts archived files only (not stray files)", async () => {
    const src = path.join(sourceDir, "s.jsonl");
    fs.writeFileSync(src, "hello world");
    await archive.archive(src, "one");

    // drop a non-archive file in the dir to make sure we ignore it
    fs.writeFileSync(path.join(tmpDir, "archive", "stray.txt"), "junk");

    const result = await archive.size();
    expect(result.files).toBe(1);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("has() returns false for an unwritten id", () => {
    expect(archive.has("never-archived")).toBe(false);
  });
});
