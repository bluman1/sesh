import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

/**
 * Stores gzipped copies of session JSONLs at <rootDir>/<sessionId>.jsonl.gz.
 * Used as a fallback when Claude Code prunes the original transcript.
 *
 * Opt-in via the `sesh.archiveTranscripts` setting. Files are written
 * atomically (write to .tmp, then rename) so partial archives never confuse
 * the reader.
 */
export class TranscriptArchive {
  constructor(private readonly rootDir: string) {}

  pathFor(sessionId: string): string {
    return path.join(this.rootDir, `${sessionId}.jsonl.gz`);
  }

  has(sessionId: string): boolean {
    try {
      return fs.statSync(this.pathFor(sessionId)).isFile();
    } catch {
      return false;
    }
  }

  /** mtime of the archived copy in ms, or null if absent. */
  archivedMtime(sessionId: string): number | null {
    try {
      return fs.statSync(this.pathFor(sessionId)).mtimeMs;
    } catch {
      return null;
    }
  }

  async archive(sourceJsonl: string, sessionId: string): Promise<void> {
    await fsp.mkdir(this.rootDir, { recursive: true });
    const dest = this.pathFor(sessionId);
    const tmp = `${dest}.tmp`;
    await pipeline(
      fs.createReadStream(sourceJsonl),
      zlib.createGzip(),
      fs.createWriteStream(tmp),
    );
    // Stamp archive mtime to match source so up-to-date checks work.
    try {
      const sourceStat = await fsp.stat(sourceJsonl);
      const date = new Date(sourceStat.mtimeMs);
      await fsp.utimes(tmp, date, date);
    } catch {
      // best-effort timestamp; on failure the archive is still valid
    }
    await fsp.rename(tmp, dest);
  }

  /**
   * Archive only if not already up-to-date with the source. Returns true if a
   * write happened.
   */
  async archiveIfNeeded(
    sourceJsonl: string,
    sessionId: string,
  ): Promise<boolean> {
    let sourceStat;
    try {
      sourceStat = await fsp.stat(sourceJsonl);
    } catch {
      return false;
    }
    const archivedMs = this.archivedMtime(sessionId);
    // Compare at second precision — utimes on macOS typically rounds to seconds
    // so sub-millisecond equality with the source is unreliable.
    if (
      archivedMs !== null &&
      Math.floor(archivedMs / 1000) >= Math.floor(sourceStat.mtimeMs / 1000)
    ) {
      return false;
    }
    await this.archive(sourceJsonl, sessionId);
    return true;
  }

  async size(): Promise<{ files: number; bytes: number }> {
    let entries: string[];
    try {
      entries = await fsp.readdir(this.rootDir);
    } catch {
      return { files: 0, bytes: 0 };
    }
    let files = 0;
    let bytes = 0;
    for (const name of entries) {
      if (!name.endsWith(".jsonl.gz")) continue;
      try {
        const st = await fsp.stat(path.join(this.rootDir, name));
        if (st.isFile()) {
          files++;
          bytes += st.size;
        }
      } catch {
        // ignore missing
      }
    }
    return { files, bytes };
  }
}
