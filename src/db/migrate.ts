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
  // Bootstrap the version-tracking table OUTSIDE the migration files so we
  // recover gracefully from DBs that pre-date schema_version (older Sesh
  // builds baked the schema_version CREATE into 001_initial.sql, which made
  // re-runs against an existing DB fail with "table sessions already
  // exists").
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );

  const applied = new Set<number>(
    (
      db
        .prepare("SELECT version FROM schema_version")
        .all() as { version: number }[]
    ).map((r) => r.version),
  );

  // Back-compat: if a `sessions` table already exists but v1 isn't recorded,
  // the DB was created by a Sesh build that didn't track migrations. Mark
  // v1 as applied so we don't try to CREATE TABLE sessions again.
  if (!applied.has(1)) {
    const hasSessionsTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'",
      )
      .get();
    if (hasSessionsTable) {
      db.prepare(
        "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
      ).run(1, Date.now());
      applied.add(1);
    }
  }

  const migrations = loadMigrations();
  const tx = db.transaction((m: Migration) => {
    db.exec(m.sql);
    db.prepare(
      "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
    ).run(m.version, Date.now());
  });
  for (const m of migrations) {
    if (!applied.has(m.version)) tx(m);
  }
}
