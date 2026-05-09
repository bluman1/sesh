import type { CommitRow, CommitFileRow } from "../db/commits";

export interface ParsedCommit {
  commit: CommitRow;
  files: CommitFileRow[];
}

export const GIT_LOG_FORMAT = "COMMIT %H|%an|%at|%s";

/**
 * Parse the output of:
 *   git log --pretty=format:"COMMIT %H|%an|%at|%s" --numstat --since=<date>
 *
 * Format example:
 *   COMMIT abc123|Michael|1700000000|feat: first thing
 *   10\t2\tsrc/a.ts
 *   0\t5\tsrc/b.ts
 *   COMMIT def456|Michael|1700000060|fix: second thing
 *   3\t0\tsrc/c.ts
 *
 * Binary files render as "-\t-\tpath" — we record them as additions=0,
 * deletions=0, status="M" (we have no signal for binary add vs modify
 * from numstat alone).
 */
export function parseGitLog(text: string, repoPath: string): ParsedCommit[] {
  const result: ParsedCommit[] = [];
  let current: ParsedCommit | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (line === "") continue;

    if (line.startsWith("COMMIT ")) {
      const fields = line.slice("COMMIT ".length).split("|");
      if (fields.length < 4) continue;
      const [sha, author, atStr, ...rest] = fields;
      const message = rest.join("|"); // commit messages can contain |
      const at = Number(atStr);
      if (!sha || Number.isNaN(at)) continue;
      current = {
        commit: {
          sha,
          repo_path: repoPath,
          branch: null,
          authored_at: at * 1000,
          author: author || null,
          message: message || null,
        },
        files: [],
      };
      result.push(current);
      continue;
    }

    if (!current) continue;

    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [a, d, ...pathParts] = parts;
    const filePath = pathParts.join("\t"); // paths can contain literal tabs
    if (!filePath) continue;

    let additions = 0;
    let deletions = 0;
    let status = "M";
    if (a === "-" && d === "-") {
      additions = 0;
      deletions = 0;
      status = "M";
    } else {
      additions = Number(a);
      deletions = Number(d);
      if (Number.isNaN(additions)) additions = 0;
      if (Number.isNaN(deletions)) deletions = 0;
      if (additions > 0 && deletions === 0) status = "A";
      else if (additions === 0 && deletions > 0) status = "D";
      else status = "M";
    }
    current.files.push({
      sha: current.commit.sha,
      path: filePath,
      status,
      additions,
      deletions,
    });
  }

  return result;
}
