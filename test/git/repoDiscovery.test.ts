import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findRepoRoot } from "../../src/git/repoDiscovery";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sesh-repo-disc-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("findRepoRoot", () => {
  it("returns the directory containing .git", () => {
    fs.mkdirSync(path.join(tmpRoot, ".git"));
    expect(findRepoRoot(tmpRoot)).toBe(tmpRoot);
  });

  it("walks up to find .git in an ancestor", () => {
    fs.mkdirSync(path.join(tmpRoot, ".git"));
    const sub = path.join(tmpRoot, "a", "b", "c");
    fs.mkdirSync(sub, { recursive: true });
    expect(findRepoRoot(sub)).toBe(tmpRoot);
  });

  it("returns null when no .git is found upward", () => {
    expect(findRepoRoot(tmpRoot)).toBeNull();
  });

  it("treats a .git file (worktree) the same as a .git dir", () => {
    fs.writeFileSync(path.join(tmpRoot, ".git"), "gitdir: /elsewhere\n");
    expect(findRepoRoot(tmpRoot)).toBe(tmpRoot);
  });

  it("returns null for a path that doesn't exist", () => {
    expect(findRepoRoot("/this/path/does/not/exist/anywhere")).toBeNull();
  });
});
