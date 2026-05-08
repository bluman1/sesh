import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readTranscript } from "../../src/scanner/transcript";

const FIXTURE = path.join(__dirname, "..", "fixtures", "sample.jsonl");

function textOf(blocks: { kind: string; text?: string }[]): string {
  return blocks
    .filter((b) => b.kind === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

describe("readTranscript", () => {
  it("returns user and assistant messages with structured blocks + timestamp", async () => {
    const messages = await readTranscript(FIXTURE);
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(messages[0].type).toBe("user");
    expect(textOf(messages[0].blocks)).toContain("first prompt");
    expect(messages[0].timestamp).toBe(
      new Date("2026-04-21T08:48:00.000Z").getTime(),
    );
  });

  it("respects limit and returns the last N messages (most recent)", async () => {
    const messages = await readTranscript(FIXTURE, 1);
    expect(messages).toHaveLength(1);
    expect(textOf(messages[0].blocks)).toBe("second prompt");
  });

  it("extracts tool_use, tool_result, and thinking blocks", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `sesh-transcript-blocks-${Date.now()}.jsonl`,
    );
    fs.writeFileSync(
      tmp,
      [
        // User text
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "run the build" },
          timestamp: "2026-05-01T10:00:00.000Z",
        }),
        // Assistant: thinking + text + tool_use
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Let me try npm run build" },
              { type: "text", text: "I'll run the build now." },
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Bash",
                input: { command: "npm run build" },
              },
            ],
          },
          timestamp: "2026-05-01T10:00:01.000Z",
        }),
        // User: tool_result
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: "Build succeeded",
                is_error: false,
              },
            ],
          },
          timestamp: "2026-05-01T10:00:02.000Z",
        }),
      ].join("\n") + "\n",
    );
    try {
      const messages = await readTranscript(tmp);
      expect(messages).toHaveLength(3);

      // Assistant message has 3 structured blocks
      const assistant = messages[1];
      expect(assistant.type).toBe("assistant");
      expect(assistant.blocks.map((b) => b.kind)).toEqual([
        "thinking",
        "text",
        "tool_use",
      ]);
      const toolUse = assistant.blocks[2];
      if (toolUse.kind === "tool_use") {
        expect(toolUse.name).toBe("Bash");
        expect(toolUse.id).toBe("toolu_1");
      }

      // User message containing only tool_result keeps its kind
      const result = messages[2];
      expect(result.type).toBe("user");
      expect(result.blocks).toHaveLength(1);
      const block = result.blocks[0];
      if (block.kind === "tool_result") {
        expect(block.toolUseId).toBe("toolu_1");
        expect(block.content).toBe("Build succeeded");
        expect(block.isError).toBe(false);
      } else {
        throw new Error("expected tool_result block");
      }
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("extracts image content blocks", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `sesh-transcript-image-${Date.now()}.jsonl`,
    );
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "What's in this screenshot?" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=",
              },
            },
          ],
        },
        timestamp: "2026-05-01T10:00:00.000Z",
      }) + "\n",
    );
    try {
      const messages = await readTranscript(tmp);
      expect(messages).toHaveLength(1);
      const blocks = messages[0].blocks;
      expect(blocks.map((b) => b.kind)).toEqual(["text", "image"]);
      const image = blocks[1];
      if (image.kind === "image") {
        expect(image.mediaType).toBe("image/png");
        expect(image.data.length).toBeGreaterThan(0);
      } else {
        throw new Error("expected image block");
      }
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("skips image blocks with no data", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `sesh-transcript-image-empty-${Date.now()}.jsonl`,
    );
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "before" },
            { type: "image", source: { type: "base64", media_type: "image/png" } },
            { type: "text", text: "after" },
          ],
        },
        timestamp: "2026-05-01T10:00:00.000Z",
      }) + "\n",
    );
    try {
      const messages = await readTranscript(tmp);
      expect(messages[0].blocks.map((b) => b.kind)).toEqual(["text", "text"]);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
