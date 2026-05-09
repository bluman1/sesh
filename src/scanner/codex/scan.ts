import * as fs from "node:fs/promises";
import * as path from "node:path";
import { extractCodexMetadata } from "./extract";
import { SESH_META_CWD } from "../../host/seshPaths";
import type { SessionRepository } from "../../db/sessions";

export interface ScanResult {
  scanned: number;
  upserted: number;
  skipped: number;
  errored: number;
}

const ROLLOUT_RE =
  /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

async function listJsonlFiles(root: string): Promise<string[]> {
  // Codex stores at <root>/<year>/<month>/<day>/rollout-*.jsonl. We walk
  // exactly three levels and collect the leaves rather than a generic
  // recursive walk — anything deeper is unexpected and should be ignored.
  const out: string[] = [];
  let years: string[];
  try {
    years = await fs.readdir(root);
  } catch {
    return out;
  }
  for (const y of years) {
    const yearPath = path.join(root, y);
    let months: string[];
    try {
      months = await fs.readdir(yearPath);
    } catch {
      continue;
    }
    for (const m of months) {
      const monthPath = path.join(yearPath, m);
      let days: string[];
      try {
        days = await fs.readdir(monthPath);
      } catch {
        continue;
      }
      for (const d of days) {
        const dayPath = path.join(monthPath, d);
        let files: string[];
        try {
          files = await fs.readdir(dayPath);
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.endsWith(".jsonl")) continue;
          out.push(path.join(dayPath, f));
        }
      }
    }
  }
  return out;
}

export function sessionIdFromCodexFilename(filename: string): string | null {
  const m = ROLLOUT_RE.exec(path.basename(filename));
  return m ? m[1] : null;
}

export async function scanCodexSessionsRoot(
  sessionsRoot: string,
  repo: SessionRepository,
): Promise<ScanResult> {
  const result: ScanResult = {
    scanned: 0,
    upserted: 0,
    skipped: 0,
    errored: 0,
  };
  const files = await listJsonlFiles(sessionsRoot);
  for (const filePath of files) {
    const id = sessionIdFromCodexFilename(filePath);
    if (!id) continue;
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    result.scanned++;

    const existing = repo.getFileStat(id);
    if (
      existing !== null &&
      existing.mtime === stat.mtimeMs &&
      existing.size === stat.size
    ) {
      result.skipped++;
      continue;
    }

    let meta;
    try {
      meta = await extractCodexMetadata(filePath);
    } catch {
      // unreadable session_meta — Codex sometimes writes empty rollout
      // files when the user closes the editor before any turn completes.
      result.errored++;
      continue;
    }

    if (meta.cwd === SESH_META_CWD) {
      // Sesh's own title-generator session — skip.
      result.skipped++;
      continue;
    }

    repo.upsert({
      id,
      source: "codex",
      project_path: meta.cwd,
      file_path: filePath,
      file_mtime: stat.mtimeMs,
      file_size: stat.size,
      created_at: meta.created_at,
      last_active_at: meta.last_active_at,
      message_count: meta.message_count,
      auto_title: meta.auto_title,
      custom_title: null,
      category_id: null,
      notes: null,
      favorited: 0,
      archived: 0,
      orphaned: 0,
      content_indexed: 0,
      last_parsed_offset: 0,
      ...meta.tokens,
      turns_indexed: 0,
      turns_last_offset: 0,
      repo_path: null,
    });
    result.upserted++;
  }
  return result;
}
