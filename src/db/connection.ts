import Database from "better-sqlite3";

export type Db = Database.Database;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  // Sesh runs one connection per VSCode window against a shared db file, so
  // writes contend on WAL's single-writer lock. A moderate busy_timeout lets
  // SQLite wait out brief contention transparently; longer contention is
  // handled by withBusyRetry (which yields the event loop between attempts,
  // unlike this synchronous wait). Keep it modest so the extension host can't
  // stall for long on a held lock.
  db.pragma("busy_timeout = 3000");
  if (path !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  return db;
}
