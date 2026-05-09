import { describe, it, expect } from "vitest";
import { parseGhPRList, parseGhPRView } from "../../src/git/ghCompanion";

describe("parseGhPRList", () => {
  it("parses gh pr list --json output", () => {
    const json = JSON.stringify([
      { number: 1, title: "Add feature", headRefName: "feature-1", url: "https://github.com/o/r/pull/1" },
      { number: 2, title: "Fix bug", headRefName: "bugfix-2", url: "https://github.com/o/r/pull/2" },
    ]);
    const result = parseGhPRList(json);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({
      number: 1, title: "Add feature", head: "feature-1", url: "https://github.com/o/r/pull/1",
    });
  });

  it("returns empty array for empty input", () => {
    expect(parseGhPRList("[]")).toEqual([]);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseGhPRList("not json")).toThrow();
  });
});

describe("parseGhPRView", () => {
  it("extracts commit shas from gh pr view --json commits", () => {
    const json = JSON.stringify({
      commits: [
        { oid: "abc123", messageHeadline: "first" },
        { oid: "def456", messageHeadline: "second" },
      ],
    });
    expect(parseGhPRView(json)).toEqual(["abc123", "def456"]);
  });

  it("returns empty array when no commits", () => {
    expect(parseGhPRView(JSON.stringify({ commits: [] }))).toEqual([]);
  });
});
