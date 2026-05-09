import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PRListEntry {
  number: number;
  title: string;
  head: string;
  url: string;
}

export interface PRWithCommits extends PRListEntry {
  commit_shas: string[];
}

export function parseGhPRList(stdout: string): PRListEntry[] {
  const data = JSON.parse(stdout) as Array<{
    number: number;
    title: string;
    headRefName: string;
    url: string;
  }>;
  return data.map((p) => ({
    number: p.number,
    title: p.title,
    head: p.headRefName,
    url: p.url,
  }));
}

export function parseGhPRView(stdout: string): string[] {
  const data = JSON.parse(stdout) as { commits: Array<{ oid: string }> };
  return (data.commits ?? []).map((c) => c.oid);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function isGhAvailable(): Promise<{ ok: boolean; reason?: string }> {
  try {
    await withTimeout(
      execFileAsync("gh", ["--version"], { maxBuffer: 1024 * 1024 }),
      8000,
      "gh --version",
    );
  } catch {
    return { ok: false, reason: "GitHub CLI (`gh`) is not installed or not in PATH." };
  }
  try {
    await withTimeout(
      execFileAsync("gh", ["auth", "status"], { maxBuffer: 1024 * 1024 }),
      8000,
      "gh auth status",
    );
  } catch {
    return { ok: false, reason: "GitHub CLI is installed but not authenticated. Run `gh auth login`." };
  }
  return { ok: true };
}

export async function listOpenPRsWithCommits(repoPath: string): Promise<PRWithCommits[]> {
  const { stdout: listOut } = await withTimeout(
    execFileAsync(
      "gh",
      ["pr", "list", "--state", "open", "--limit", "100", "--json", "number,title,headRefName,url"],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 },
    ),
    8000,
    "gh pr list",
  );
  const prs = parseGhPRList(listOut);
  const enriched = await Promise.all(
    prs.map(async (p) => {
      try {
        const { stdout } = await withTimeout(
          execFileAsync(
            "gh",
            ["pr", "view", String(p.number), "--json", "commits"],
            { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 },
          ),
          8000,
          `gh pr view ${p.number}`,
        );
        return { ...p, commit_shas: parseGhPRView(stdout) };
      } catch {
        return { ...p, commit_shas: [] };
      }
    }),
  );
  return enriched;
}
