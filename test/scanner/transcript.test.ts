import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { readTranscript } from "../../src/scanner/transcript";

const FIXTURE = path.join(__dirname, "..", "fixtures", "sample.jsonl");

describe("readTranscript", () => {
  it("returns user and assistant messages with text + timestamp", async () => {
    const messages = await readTranscript(FIXTURE);
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(messages[0].type).toBe("user");
    expect(messages[0].text).toContain("first prompt");
    expect(messages[0].timestamp).toBe(new Date("2026-04-21T08:48:00.000Z").getTime());
  });

  it("respects limit parameter", async () => {
    const messages = await readTranscript(FIXTURE, 1);
    expect(messages).toHaveLength(1);
  });
});
