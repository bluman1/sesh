import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TranscriptMessage } from "../scanner/transcript";

const CLAUDE_CANDIDATES = [
  "claude",
  path.join(os.homedir(), ".local", "bin", "claude"),
];
const CODEX_CANDIDATES = [
  "codex",
  "/Applications/Codex.app/Contents/Resources/codex",
];

const PROMPT_TIMEOUT_MS = 60_000;
const TITLE_CHAR_CAP = 80;

export class TitleGenerationError extends Error {}

export function findExecutable(candidates: string[]): string | null {
  for (const c of candidates) {
    if (path.isAbsolute(c)) {
      try {
        if (fs.existsSync(c)) return c;
      } catch {
        // ignore
      }
      continue;
    }
    try {
      const result = cp.execFileSync("which", [c], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      const found = result.toString().trim();
      if (found) return found;
    } catch {
      // not on PATH; try next candidate
    }
  }
  return null;
}

export function buildExcerpt(messages: TranscriptMessage[]): string {
  // Take up to 3 messages' worth of plain text so the model has enough
  // context to summarise without paying for a giant prompt.
  const parts: string[] = [];
  for (const m of messages) {
    const text = m.blocks
      .filter((b) => b.kind === "text" || b.kind === "thinking")
      .map((b) => (b as { text: string }).text)
      .join("\n")
      .trim();
    if (!text) continue;
    const role = m.type === "user" ? "User" : "Assistant";
    parts.push(`${role}: ${text.slice(0, 800)}`);
    if (parts.length >= 3) break;
  }
  return parts.join("\n\n");
}

export function buildPrompt(excerpt: string): string {
  return `Generate a concise 5-7 word title for this conversation. Output only the title, no quotes, no punctuation, no preamble. The title should capture the core topic or task.

Conversation:
${excerpt}`;
}

export function postprocess(raw: string): string {
  let line = raw.trim().split("\n").find((l) => l.trim().length > 0) ?? "";
  line = line.trim();
  // Strip surrounding quotes / backticks the model often adds despite the
  // instruction to omit them.
  line = line.replace(/^[`"'“‘]+|[`"'”’]+$/g, "").trim();
  // Strip trailing punctuation.
  line = line.replace(/[.!?,;:]+$/, "").trim();
  if (line.length > TITLE_CHAR_CAP) line = line.slice(0, TITLE_CHAR_CAP).trim();
  return line;
}

export interface RunCliOptions {
  spawn?: typeof cp.spawn;
  timeoutMs?: number;
}

async function runCli(
  cliPath: string,
  args: string[],
  prompt: string,
  options: RunCliOptions = {},
): Promise<string> {
  const spawn = options.spawn ?? cp.spawn;
  const timeoutMs = options.timeoutMs ?? PROMPT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const proc = spawn(cliPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      reject(
        new TitleGenerationError(
          `CLI did not return within ${Math.round(timeoutMs / 1000)}s`,
        ),
      );
    }, timeoutMs);

    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new TitleGenerationError(err.message));
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new TitleGenerationError(
            `CLI exited with code ${code}: ${stderr.trim().slice(0, 200) || "no stderr"}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });

    if (proc.stdin) {
      proc.stdin.write(prompt);
      proc.stdin.end();
    }
  });
}

export interface GenerateTitleDeps extends RunCliOptions {
  // Override the candidates to search — primarily used by tests. In production
  // we ship the canonical lists above.
  resolveExecutable?: (source: "claude-code" | "codex") => string | null;
}

export async function generateTitle(
  source: string,
  excerpt: string,
  deps: GenerateTitleDeps = {},
): Promise<string> {
  const isCodex = source === "codex";
  const cliPath = deps.resolveExecutable
    ? deps.resolveExecutable(isCodex ? "codex" : "claude-code")
    : findExecutable(isCodex ? CODEX_CANDIDATES : CLAUDE_CANDIDATES);

  if (!cliPath) {
    throw new TitleGenerationError(
      isCodex
        ? "Codex CLI not found on PATH or at /Applications/Codex.app. Install it and run `codex login`, then try again."
        : "Claude CLI not found on PATH or in ~/.local/bin. Install it and authenticate, then try again.",
    );
  }

  if (!excerpt.trim()) {
    throw new TitleGenerationError(
      "Session has no readable text to summarise.",
    );
  }

  const prompt = buildPrompt(excerpt);
  // claude reads the prompt from stdin when run as `claude -p` with no
  // positional argument, which lets us pass arbitrarily long content
  // without hitting argv length limits. codex exec accepts stdin too when
  // the prompt argument is `-`.
  const args = isCodex ? ["exec", "-"] : ["-p"];
  const raw = await runCli(cliPath, args, prompt, deps);
  const title = postprocess(raw);
  if (!title) {
    throw new TitleGenerationError("CLI returned no usable title.");
  }
  return title;
}
