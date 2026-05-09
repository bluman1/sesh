import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { runGitLog } from "../../src/git/runGit";

let tmpRepo: string;

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "sesh-rungit-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmpRepo });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: tmpRepo });
  execFileSync("git", ["config", "user.name", "Tester"], { cwd: tmpRepo });
  fs.writeFileSync(path.join(tmpRepo, "a.txt"), "hello\n");
  execFileSync("git", ["add", "."], { cwd: tmpRepo });
  execFileSync("git", ["commit", "-q", "-m", "first"], { cwd: tmpRepo });
});

afterEach(() => {
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

describe("runGitLog", () => {
  it("returns log output for a real repo", async () => {
    const out = await runGitLog(tmpRepo, 0);
    expect(out).toContain("COMMIT ");
    expect(out).toContain("first");
    expect(out).toContain("a.txt");
  });

  it("rejects when given a non-repo path", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sesh-not-repo-"));
    try {
      await expect(runGitLog(tmp, 0)).rejects.toThrow();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("respects the since cutoff", async () => {
    // since = far future → empty
    const future = Date.now() + 365 * 86400 * 1000;
    const out = await runGitLog(tmpRepo, future);
    expect(out.trim()).toBe("");
  });
});
