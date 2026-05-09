import { describe, it, expect } from "vitest";
import { parseGitLog } from "../../src/git/gitLog";

const FIXTURE = [
  "COMMIT abc123|Michael|1700000000|feat: first thing",
  "10\t2\tsrc/a.ts",
  "0\t5\tsrc/b.ts",
  "COMMIT def456|Michael|1700000060|fix: second thing",
  "3\t0\tsrc/c.ts",
  "COMMIT ghi789|Other|1700000120|docs: README",
  "1\t1\tREADME.md",
  "",
].join("\n");

describe("parseGitLog", () => {
  it("parses three commits with their files", () => {
    const result = parseGitLog(FIXTURE, "/Users/m/proj");
    expect(result.length).toBe(3);
    expect(result[0].commit.sha).toBe("abc123");
    expect(result[0].commit.author).toBe("Michael");
    expect(result[0].commit.authored_at).toBe(1700000000000);
    expect(result[0].commit.message).toBe("feat: first thing");
    expect(result[0].files.length).toBe(2);
  });

  it("infers status from numstat", () => {
    const result = parseGitLog(FIXTURE, "/Users/m/proj");
    const c0 = result[0];
    expect(c0.files.find((f) => f.path === "src/a.ts")?.status).toBe("M");
    expect(c0.files.find((f) => f.path === "src/b.ts")?.status).toBe("D");
    const c1 = result[1];
    expect(c1.files.find((f) => f.path === "src/c.ts")?.status).toBe("A");
  });

  it("populates additions and deletions", () => {
    const result = parseGitLog(FIXTURE, "/Users/m/proj");
    const file = result[0].files.find((f) => f.path === "src/a.ts")!;
    expect(file.additions).toBe(10);
    expect(file.deletions).toBe(2);
  });

  it("handles empty input", () => {
    expect(parseGitLog("", "/Users/m/proj")).toEqual([]);
  });

  it("skips malformed COMMIT lines", () => {
    const bad = [
      "COMMIT abc123|Michael|1700000000|feat",
      "COMMIT-not-really-malformed",
      "10\t2\tsrc/a.ts",
    ].join("\n");
    const result = parseGitLog(bad, "/Users/m/proj");
    expect(result.length).toBe(1);
    expect(result[0].files.length).toBe(1);
  });

  it("attaches all files to the most recent COMMIT line", () => {
    const result = parseGitLog(FIXTURE, "/Users/m/proj");
    expect(result[2].files[0].path).toBe("README.md");
    expect(result[2].files[0].sha).toBe("ghi789");
  });

  it("sets repo_path on every commit", () => {
    const result = parseGitLog(FIXTURE, "/Users/m/proj");
    for (const r of result) expect(r.commit.repo_path).toBe("/Users/m/proj");
  });

  it("treats binary diffs (- - path) as additions=0 deletions=0 status=M", () => {
    const binary = [
      "COMMIT abc123|Michael|1700000000|add image",
      "-\t-\tassets/logo.png",
    ].join("\n");
    const result = parseGitLog(binary, "/p");
    expect(result[0].files[0].path).toBe("assets/logo.png");
    expect(result[0].files[0].additions).toBe(0);
    expect(result[0].files[0].deletions).toBe(0);
    expect(result[0].files[0].status).toBe("M");
  });
});
