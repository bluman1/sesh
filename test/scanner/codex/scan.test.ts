import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDb, type Db } from "../../../src/db/connection";
import { runMigrations } from "../../../src/db/migrate";
import { SessionRepository } from "../../../src/db/sessions";
import {
  scanCodexSessionsRoot,
  sessionIdFromCodexFilename,
} from "../../../src/scanner/codex/scan";
import { SESH_META_CWD } from "../../../src/host/seshPaths";

const SAMPLE_FIXTURE = path.join(
  __dirname,
  "..",
  "..",
  "fixtures",
  "codex",
  "sample.jsonl",
);

function setupCodexRoot(): {
  root: string;
  copyInto: (year: string, month: string, day: string, name: string) => string;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sesh-codex-"));
  return {
    root,
    copyInto: (year, month, day, name) => {
      const dir = path.join(root, year, month, day);
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, name);
      fs.copyFileSync(SAMPLE_FIXTURE, dest);
      return dest;
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("sessionIdFromCodexFilename", () => {
  it("extracts the trailing UUID from a rollout filename", () => {
    expect(
      sessionIdFromCodexFilename(
        "rollout-2026-04-04T10-00-00-019d5933-0c3e-7103-8c4b-68a7232a71b8.jsonl",
      ),
    ).toBe("019d5933-0c3e-7103-8c4b-68a7232a71b8");
  });

  it("returns null for unrecognised filenames", () => {
    expect(sessionIdFromCodexFilename("not-a-rollout.jsonl")).toBeNull();
    expect(sessionIdFromCodexFilename("rollout-bad-name.jsonl")).toBeNull();
  });
});

describe("scanCodexSessionsRoot", () => {
  let db: Db;
  let repo: SessionRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    repo = new SessionRepository(db);
  });

  it("walks year/month/day and upserts each rollout file as source=codex", async () => {
    const root = setupCodexRoot();
    try {
      root.copyInto(
        "2026",
        "04",
        "04",
        "rollout-2026-04-04T10-00-00-019d5933-0c3e-7103-8c4b-68a7232a71b8.jsonl",
      );
      root.copyInto(
        "2026",
        "04",
        "05",
        "rollout-2026-04-05T11-00-00-019d6044-1d3e-7103-8c4b-68a7232a71b9.jsonl",
      );
      const result = await scanCodexSessionsRoot(root.root, repo);
      expect(result.scanned).toBe(2);
      expect(result.upserted).toBe(2);
      expect(result.skipped).toBe(0);
      const rows = repo.listAllNonArchived();
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.source === "codex")).toBe(true);
    } finally {
      root.cleanup();
    }
  });

  it("skips files unchanged on rescan (mtime + size match)", async () => {
    const root = setupCodexRoot();
    try {
      root.copyInto(
        "2026",
        "04",
        "04",
        "rollout-2026-04-04T10-00-00-019d5933-0c3e-7103-8c4b-68a7232a71b8.jsonl",
      );
      await scanCodexSessionsRoot(root.root, repo);
      const second = await scanCodexSessionsRoot(root.root, repo);
      expect(second.scanned).toBe(1);
      expect(second.skipped).toBe(1);
      expect(second.upserted).toBe(0);
    } finally {
      root.cleanup();
    }
  });

  it("returns empty result when root doesn't exist", async () => {
    const result = await scanCodexSessionsRoot(
      "/var/empty/definitely-not-a-real-path-codex",
      repo,
    );
    expect(result).toEqual({
      scanned: 0,
      upserted: 0,
      skipped: 0,
      errored: 0,
    });
  });

  it("filters out sessions whose session_meta cwd matches SESH_META_CWD", async () => {
    const root = setupCodexRoot();
    try {
      // Custom rollout file with cwd set to SESH_META_CWD.
      const dir = path.join(root.root, "2026", "04", "04");
      fs.mkdirSync(dir, { recursive: true });
      const filename =
        "rollout-2026-04-04T10-00-00-019d5933-0c3e-7103-8c4b-68a7232a71b8.jsonl";
      const dest = path.join(dir, filename);
      const lines = [
        JSON.stringify({
          timestamp: "2026-04-04T10:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "019d5933-0c3e-7103-8c4b-68a7232a71b8",
            timestamp: "2026-04-04T10:00:00.000Z",
            cwd: SESH_META_CWD,
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-04T10:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Generate a title" }],
          },
        }),
      ].join("\n");
      fs.writeFileSync(dest, lines + "\n");
      const result = await scanCodexSessionsRoot(root.root, repo);
      expect(result.scanned).toBe(1);
      expect(result.upserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(repo.findById("019d5933-0c3e-7103-8c4b-68a7232a71b8")).toBeNull();
    } finally {
      root.cleanup();
    }
  });

  it("ignores files that don't match the rollout-*-uuid.jsonl pattern", async () => {
    const root = setupCodexRoot();
    try {
      const dir = path.join(root.root, "2026", "04", "04");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "stray.jsonl"), "garbage\n");
      fs.writeFileSync(path.join(dir, "rollout-bad.jsonl"), "garbage\n");
      const result = await scanCodexSessionsRoot(root.root, repo);
      expect(result.scanned).toBe(0);
    } finally {
      root.cleanup();
    }
  });
});
