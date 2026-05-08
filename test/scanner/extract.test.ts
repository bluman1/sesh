import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { extractMetadata } from "../../src/scanner/extract";

const FIXTURE = path.join(__dirname, "..", "fixtures", "sample.jsonl");
const LONG_PROMPT = path.join(__dirname, "..", "fixtures", "long-prompt.jsonl");
const NO_CWD = path.join(__dirname, "..", "fixtures", "no-cwd.jsonl");

describe("extractMetadata", () => {
  it("extracts cwd, auto_title, timestamps, and message count", async () => {
    const meta = await extractMetadata(FIXTURE, "sample-id");
    expect(meta.cwd).toBe("/tmp/proj");
    expect(meta.auto_title).toBe("first prompt");
    expect(meta.created_at).toBe(new Date("2026-04-21T08:47:11.844Z").getTime());
    expect(meta.last_active_at).toBe(new Date("2026-04-21T08:50:00.000Z").getTime());
    expect(meta.message_count).toBeGreaterThanOrEqual(3);
  });

  it("truncates auto_title to 80 chars", async () => {
    const meta = await extractMetadata(LONG_PROMPT, "long-id");
    expect(meta.auto_title?.length).toBe(80);
    expect(meta.auto_title?.startsWith("This is a very long")).toBe(true);
  });

  it("falls back to decoded dirname when cwd missing", async () => {
    const meta = await extractMetadata(NO_CWD, "no-cwd-id", {
      fallbackEncodedDir: "-tmp-otherproj",
    });
    expect(meta.cwd).toBe("/tmp/otherproj");
  });
});
