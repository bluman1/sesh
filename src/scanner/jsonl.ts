import * as fs from "node:fs";
import * as readline from "node:readline";
import * as zlib from "node:zlib";

export async function* streamJsonl(
  filePath: string,
): AsyncGenerator<Record<string, unknown>> {
  const raw = fs.createReadStream(filePath);
  // Transparently handle .jsonl.gz archives produced by TranscriptArchive.
  const input = filePath.endsWith(".gz") ? raw.pipe(zlib.createGunzip()) : raw;
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // skip malformed lines silently; caller logs at higher level if needed
    }
  }
}
