import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { streamJsonl } from "../../src/scanner/jsonl";

const FIXTURE = path.join(__dirname, "..", "fixtures", "sample.jsonl");

describe("streamJsonl", () => {
  it("yields parsed records and skips malformed lines", async () => {
    const records = [];
    for await (const rec of streamJsonl(FIXTURE)) {
      records.push(rec);
    }
    expect(records).toHaveLength(4);
    expect(records[1].cwd).toBe("/tmp/proj");
    expect(records[3].type).toBe("user");
  });
});
