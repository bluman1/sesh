import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { readCodexTranscript } from "../../../src/scanner/codex/transcript";

const FIXTURE = path.join(
  __dirname,
  "..",
  "..",
  "fixtures",
  "codex",
  "sample.jsonl",
);

describe("readCodexTranscript", () => {
  it("emits text + thinking + tool_use + tool_result blocks in order", async () => {
    const messages = await readCodexTranscript(FIXTURE);
    // Expected sequence (skipping developer-role + env_context-only message):
    // user (real prompt), assistant thinking, assistant text, assistant tool_use,
    // user tool_result, assistant text
    const sequence = messages.map((m) => ({
      type: m.type,
      kinds: m.blocks.map((b) => b.kind),
    }));
    expect(sequence).toEqual([
      { type: "user", kinds: ["text"] },
      { type: "assistant", kinds: ["thinking"] },
      { type: "assistant", kinds: ["text"] },
      { type: "assistant", kinds: ["tool_use"] },
      { type: "user", kinds: ["tool_result"] },
      { type: "assistant", kinds: ["text"] },
    ]);
  });

  it("strips My request for Codex wrapper from the user prompt", async () => {
    const messages = await readCodexTranscript(FIXTURE);
    const user = messages[0];
    if (user.blocks[0].kind !== "text") throw new Error("expected text block");
    // Real prompt comes after the heading; the wrapper noise is stripped by
    // CODEX_NOISE_RE for environment_context but the IDE wrapper text remains
    // (we don't synthesize a heading-aware strip in transcript view).
    expect(user.blocks[0].text).toContain("Run the build for me");
    expect(user.blocks[0].text).not.toContain("<environment_context>");
  });

  it("parses function_call arguments JSON", async () => {
    const messages = await readCodexTranscript(FIXTURE);
    const toolUseMsg = messages.find((m) =>
      m.blocks.some((b) => b.kind === "tool_use"),
    );
    if (!toolUseMsg) throw new Error("expected tool_use message");
    const block = toolUseMsg.blocks[0];
    if (block.kind !== "tool_use") throw new Error("kind mismatch");
    expect(block.name).toBe("exec_command");
    expect(block.id).toBe("call_1");
    expect(block.input).toEqual({
      cmd: "npm run build",
      workdir: "/Users/test/proj",
    });
  });

  it("preserves function_call_output content as tool_result body", async () => {
    const messages = await readCodexTranscript(FIXTURE);
    const resultMsg = messages.find((m) =>
      m.blocks.some((b) => b.kind === "tool_result"),
    );
    if (!resultMsg) throw new Error("expected tool_result message");
    const block = resultMsg.blocks[0];
    if (block.kind !== "tool_result") throw new Error("kind mismatch");
    expect(block.toolUseId).toBe("call_1");
    expect(block.content).toBe("Build succeeded\n");
    expect(block.isError).toBe(false);
  });

  it("respects limit and returns the last N", async () => {
    const messages = await readCodexTranscript(FIXTURE, 2);
    expect(messages.length).toBe(2);
    // Last two should be tool_result + final assistant text.
    expect(messages.map((m) => m.blocks[0].kind)).toEqual([
      "tool_result",
      "text",
    ]);
  });
});
