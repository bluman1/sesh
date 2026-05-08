import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { extractCodexMetadata } from "../../../src/scanner/codex/extract";

const FIXTURE = path.join(
  __dirname,
  "..",
  "..",
  "fixtures",
  "codex",
  "sample.jsonl",
);

describe("extractCodexMetadata", () => {
  it("pulls cwd from session_meta", async () => {
    const meta = await extractCodexMetadata(FIXTURE);
    expect(meta.cwd).toBe("/Users/test/proj");
  });

  it("counts user + assistant messages, ignoring reasoning + tool records", async () => {
    const meta = await extractCodexMetadata(FIXTURE);
    // developer-role message + user(env_context) + user(real prompt) + 2x assistant = 5
    // (developer role is not user/assistant so it's filtered, leaving 4)
    expect(meta.message_count).toBe(4);
  });

  it("uses My request for Codex heading as auto_title source when present", async () => {
    const meta = await extractCodexMetadata(FIXTURE);
    expect(meta.auto_title).toBe("Run the build for me");
  });

  it("captures created_at and last_active_at from timestamps", async () => {
    const meta = await extractCodexMetadata(FIXTURE);
    expect(meta.created_at).toBe(
      new Date("2026-04-04T10:00:00.000Z").getTime(),
    );
    expect(meta.last_active_at).toBe(
      new Date("2026-04-04T10:00:09.000Z").getTime(),
    );
  });

  it("throws when session_meta has no cwd", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const tmp = path.join(os.tmpdir(), `sesh-codex-no-cwd-${Date.now()}.jsonl`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        timestamp: "2026-04-04T10:00:00.000Z",
        type: "session_meta",
        payload: { id: "abc" },
      }) + "\n",
    );
    try {
      await expect(extractCodexMetadata(tmp)).rejects.toThrow(
        /no session_meta cwd/,
      );
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
