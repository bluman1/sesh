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

export async function isGhAvailable(): Promise<{ ok: boolean; reason?: string }> {
  try {
    await execFileAsync("gh", ["--version"], { maxBuffer: 1024 * 1024 });
  } catch {
    return { ok: false, reason: "GitHub CLI (`gh`) is not installed or not in PATH." };
  }
  try {
    await execFileAsync("gh", ["auth", "status"], { maxBuffer: 1024 * 1024 });
  } catch {
    return { ok: false, reason: "GitHub CLI is installed but not authenticated. Run `gh auth login`." };
  }
  return { ok: true };
}

export async function listOpenPRsWithCommits(repoPath: string): Promise<PRWithCommits[]> {
  const { stdout: listOut } = await execFileAsync(
    "gh",
    ["pr", "list", "--state", "open", "--json", "number,title,headRefName,url"],
    { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 },
  );
  const prs = parseGhPRList(listOut);
  const enriched: PRWithCommits[] = [];
  for (const p of prs) {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["pr", "view", String(p.number), "--json", "commits"],
        { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 },
      );
      enriched.push({ ...p, commit_shas: parseGhPRView(stdout) });
    } catch {
      enriched.push({ ...p, commit_shas: [] });
    }
  }
  return enriched;
}
