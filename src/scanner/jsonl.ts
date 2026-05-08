import * as fs from "node:fs";
import * as readline from "node:readline";

export async function* streamJsonl(
  filePath: string,
): AsyncGenerator<Record<string, unknown>> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // skip malformed lines silently; caller logs at higher level if needed
    }
  }
}
