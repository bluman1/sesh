import { describe, it, expect } from "vitest";
import { basename } from "../../src/util/path";

describe("basename", () => {
  it("returns the last slash-separated segment", () => {
    expect(basename("/Users/me/work/sesh")).toBe("sesh");
    expect(basename("/foo/bar.ts")).toBe("bar.ts");
  });

  it("tolerates trailing slashes", () => {
    expect(basename("/Users/me/work/sesh/")).toBe("sesh");
    expect(basename("/foo///")).toBe("foo");
  });

  it("returns null for blank or null input", () => {
    expect(basename(null)).toBeNull();
    expect(basename(undefined)).toBeNull();
    expect(basename("")).toBeNull();
    expect(basename("/")).toBeNull();
  });

  it("returns the input unchanged when there is no slash", () => {
    expect(basename("sesh")).toBe("sesh");
  });
});
