import * as fs from "node:fs";
import * as path from "node:path";
import type { Db } from "./connection";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

interface Migration {
  version: number;
  name: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) throw new Error(`Bad migration filename: ${file}`);
    return {
      version: Number(match[1]),
      name: match[2],
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"),
    };
  });
}

export function runMigrations(db: Db): void {
  const hasVersionTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
    )
    .get();
  const applied = new Set<number>(
    hasVersionTable
      ? (db.prepare("SELECT version FROM schema_version").all() as {
          version: number;
        }[]).map((r) => r.version)
      : [],
  );
  const migrations = loadMigrations();
  const tx = db.transaction((m: Migration) => {
    db.exec(m.sql);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
      m.version,
      Date.now(),
    );
  });
  for (const m of migrations) {
    if (!applied.has(m.version)) tx(m);
  }
}
