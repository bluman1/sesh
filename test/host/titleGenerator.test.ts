import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildExcerpt,
  buildPrompt,
  postprocess,
  generateTitle,
  TitleGenerationError,
} from "../../src/host/titleGenerator";
import type { TranscriptMessage } from "../../src/scanner/transcript";
import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";

describe("buildExcerpt", () => {
  it("collects up to 3 messages of text/thinking, truncating each at 800 chars", () => {
    const big = "x".repeat(2000);
    const msgs: TranscriptMessage[] = [
      {
        type: "user",
        timestamp: 1,
        blocks: [{ kind: "text", text: "first prompt" }],
      },
      {
        type: "assistant",
        timestamp: 2,
        blocks: [{ kind: "thinking", text: "let me think" }],
      },
      {
        type: "assistant",
        timestamp: 3,
        blocks: [{ kind: "text", text: big }],
      },
      {
        type: "user",
        timestamp: 4,
        blocks: [{ kind: "text", text: "fourth message — should NOT appear" }],
      },
    ];
    const out = buildExcerpt(msgs);
    expect(out).toContain("User: first prompt");
    expect(out).toContain("Assistant: let me think");
    expect(out).toContain("Assistant: " + "x".repeat(800));
    expect(out).not.toContain("fourth message");
  });

  it("skips messages with no text/thinking content (e.g. tool-only)", () => {
    const msgs: TranscriptMessage[] = [
      {
        type: "assistant",
        timestamp: 1,
        blocks: [{ kind: "tool_use", id: "1", name: "Bash", input: {} }],
      },
      {
        type: "user",
        timestamp: 2,
        blocks: [{ kind: "text", text: "real prompt" }],
      },
    ];
    const out = buildExcerpt(msgs);
    expect(out).toBe("User: real prompt");
  });
});

describe("buildPrompt", () => {
  it("includes the excerpt and tells the model to output a title only", () => {
    const out = buildPrompt("User: hello\nAssistant: hi");
    expect(out).toContain("5-7 word title");
    expect(out).toContain("no quotes");
    expect(out).toContain("User: hello");
  });
});

describe("postprocess", () => {
  it("returns the first non-empty line trimmed", () => {
    expect(postprocess("\n  Migration plan for legacy API\n")).toBe(
      "Migration plan for legacy API",
    );
  });

  it("strips surrounding straight + curly quotes and backticks", () => {
    expect(postprocess('"Hello world"')).toBe("Hello world");
    expect(postprocess("`Hello world`")).toBe("Hello world");
    expect(postprocess("“Hello world”")).toBe("Hello world");
    expect(postprocess("‘Hello world’")).toBe("Hello world");
  });

  it("strips trailing punctuation", () => {
    expect(postprocess("Hello world.")).toBe("Hello world");
    expect(postprocess("Hello world!?")).toBe("Hello world");
  });

  it("caps at 80 chars on grapheme-naïve length", () => {
    const long = "a".repeat(120);
    expect(postprocess(long).length).toBe(80);
  });

  it("returns empty string for empty input", () => {
    expect(postprocess("")).toBe("");
    expect(postprocess("   \n   ")).toBe("");
  });
});

// ───────── generateTitle integration via a fake spawn ─────────

class FakeProc extends EventEmitter {
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
  stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  killed = false;
  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    return true;
  }
}

function fakeSpawn(opts: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  delay?: number;
}): typeof import("node:child_process").spawn {
  return ((..._args: unknown[]) => {
    const proc = new FakeProc();
    setTimeout(() => {
      if (opts.stdout) proc.stdout.push(opts.stdout);
      proc.stdout.push(null);
      if (opts.stderr) proc.stderr.push(opts.stderr);
      proc.stderr.push(null);
      proc.emit("close", opts.exitCode);
    }, opts.delay ?? 0);
    return proc;
  }) as unknown as typeof import("node:child_process").spawn;
}

describe("generateTitle", () => {
  let metaCwd: string;
  beforeEach(async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    metaCwd = fs.mkdtempSync(path.join(os.tmpdir(), "sesh-meta-"));
  });
  afterEach(async () => {
    if (metaCwd) {
      const fs = await import("node:fs");
      try {
        fs.rmSync(metaCwd, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("rejects with a friendly message when the CLI cannot be located", async () => {
    await expect(
      generateTitle("claude-code", "User: hi", {
        resolveExecutable: () => null,
        metaCwd,
      }),
    ).rejects.toThrow(/Claude CLI not found/);
  });

  it("uses the codex error message for source=codex", async () => {
    await expect(
      generateTitle("codex", "User: hi", {
        resolveExecutable: () => null,
        metaCwd,
      }),
    ).rejects.toThrow(/Codex CLI not found/);
  });

  it("rejects when there's no excerpt to summarise", async () => {
    await expect(
      generateTitle("claude-code", "   ", {
        resolveExecutable: () => "/fake/claude",
        metaCwd,
      }),
    ).rejects.toThrow(/no readable text/);
  });

  it("returns a postprocessed title when the CLI exits 0 with content", async () => {
    const title = await generateTitle("claude-code", "User: hi", {
      resolveExecutable: () => "/fake/claude",
      spawn: fakeSpawn({ exitCode: 0, stdout: '"Refactor auth flow"\n' }),
      metaCwd,
    });
    expect(title).toBe("Refactor auth flow");
  });

  it("rejects when the CLI exits non-zero", async () => {
    await expect(
      generateTitle("claude-code", "User: hi", {
        resolveExecutable: () => "/fake/claude",
        spawn: fakeSpawn({ exitCode: 1, stderr: "rate limited" }),
        metaCwd,
      }),
    ).rejects.toThrow(TitleGenerationError);
  });

  it("rejects when the CLI returns no usable text", async () => {
    await expect(
      generateTitle("claude-code", "User: hi", {
        resolveExecutable: () => "/fake/claude",
        spawn: fakeSpawn({ exitCode: 0, stdout: "  \n  \n" }),
        metaCwd,
      }),
    ).rejects.toThrow(/no usable title/);
  });

  it("rejects on timeout", async () => {
    await expect(
      generateTitle("claude-code", "User: hi", {
        resolveExecutable: () => "/fake/claude",
        spawn: fakeSpawn({ exitCode: 0, stdout: "fine", delay: 200 }),
        timeoutMs: 50,
        metaCwd,
      }),
    ).rejects.toThrow(/did not return/);
  });

  it("spawns the CLI with the meta-cwd so the resulting JSONL is filterable", async () => {
    let observedCwd: string | undefined;
    const recordingSpawn = ((..._args: unknown[]) => {
      const opts = _args[2] as { cwd?: string } | undefined;
      observedCwd = opts?.cwd;
      const proc = new FakeProc();
      setTimeout(() => {
        proc.stdout.push("Generated title\n");
        proc.stdout.push(null);
        proc.stderr.push(null);
        proc.emit("close", 0);
      }, 0);
      return proc;
    }) as unknown as typeof import("node:child_process").spawn;

    await generateTitle("claude-code", "User: hi", {
      resolveExecutable: () => "/fake/claude",
      spawn: recordingSpawn,
      metaCwd,
    });
    expect(observedCwd).toBe(metaCwd);
  });

  it("creates the metaCwd directory if it doesn't yet exist", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const nested = path.join(metaCwd, "deep", "nested", "cli");
    expect(fs.existsSync(nested)).toBe(false);
    await generateTitle("claude-code", "User: hi", {
      resolveExecutable: () => "/fake/claude",
      spawn: fakeSpawn({ exitCode: 0, stdout: "Title here\n" }),
      metaCwd: nested,
    });
    expect(fs.existsSync(nested)).toBe(true);
  });
});
