// `node:sqlite` is a recent builtin that static bundlers/transformers (esbuild,
// and Vite via vitest) choke on if imported normally — esbuild's CJS output
// can't honor an `import`/`import.meta`, and Vite tries to resolve it as a
// file. `process.getBuiltinModule` (Node 22.3+) returns the builtin at runtime
// and is invisible to static analysis. Types come from the type-only
// `typeof import(...)` (erased, never emitted), backed by src/node-sqlite.d.ts.
type SqliteModule = typeof import("node:sqlite");
type StatementSync = InstanceType<SqliteModule["StatementSync"]>;
type DatabaseSyncInstance = InstanceType<SqliteModule["DatabaseSync"]>;
const { DatabaseSync } = (
  process as unknown as { getBuiltinModule(id: string): SqliteModule }
).getBuiltinModule("node:sqlite");

/**
 * The database surface the rest of Sesh depends on. Backed by Node's built-in
 * `node:sqlite` (shipped with Electron's Node — no native module, so nothing
 * to ABI-match against the host VSCode/Electron version). This mirrors the
 * slice of the better-sqlite3 API the codebase used: prepare/exec/close, plus
 * a `transaction()` wrapper and a `pragma()` helper that node:sqlite lacks.
 */
export interface Db {
  prepare(sql: string): StatementSync;
  exec(sql: string): void;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  pragma(source: string, opts?: { simple?: boolean }): unknown;
  close(): void;
}

class NodeSqliteDb implements Db {
  // Depth of currently-open transactions on this connection. Safe as a plain
  // counter because transaction bodies are synchronous (no async interleaving).
  private txDepth = 0;

  constructor(private readonly raw: DatabaseSyncInstance) {}

  prepare(sql: string): StatementSync {
    const stmt = this.raw.prepare(sql);
    // Repos bind named params by spreading whole row objects, which can carry
    // keys beyond the statement's parameters (e.g. promptLints). better-sqlite3
    // tolerated that; node:sqlite throws "Unknown named parameter" unless we
    // opt in here.
    stmt.setAllowUnknownNamedParameters(true);
    return stmt;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /**
   * Mirror better-sqlite3's `db.transaction(fn)`: returns a function that runs
   * `fn` inside a transaction, rolling back on throw. Nesting-aware — the
   * outermost call uses BEGIN/COMMIT/ROLLBACK; nested calls use SAVEPOINTs
   * (Sesh nests, e.g. an indexer transaction that calls a repo's upsertMany).
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const depth = this.txDepth;
      const sp = `sesh_sp_${depth}`;
      this.raw.exec(depth === 0 ? "BEGIN" : `SAVEPOINT ${sp}`);
      this.txDepth = depth + 1;
      try {
        const result = fn(...args);
        this.raw.exec(depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
        return result;
      } catch (err) {
        try {
          if (depth === 0) {
            this.raw.exec("ROLLBACK");
          } else {
            // ROLLBACK TO rewinds but keeps the savepoint; RELEASE removes it.
            this.raw.exec(`ROLLBACK TO ${sp}`);
            this.raw.exec(`RELEASE ${sp}`);
          }
        } catch {
          // A failed rollback must not mask the original error.
        }
        throw err;
      } finally {
        this.txDepth = depth;
      }
    };
  }

  /**
   * better-sqlite3-style pragma helper. `pragma("journal_mode = WAL")` sets;
   * `pragma("busy_timeout", { simple: true })` returns the scalar value.
   */
  pragma(source: string, opts?: { simple?: boolean }): unknown {
    const rows = this.raw.prepare(`PRAGMA ${source}`).all();
    if (opts?.simple) {
      const first = rows[0] as Record<string, unknown> | undefined;
      return first ? Object.values(first)[0] : undefined;
    }
    return rows;
  }

  close(): void {
    this.raw.close();
  }
}

export function openDb(path: string): Db {
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys = ON");
  // One connection per VSCode window against a shared db file → writes contend
  // on WAL's single-writer lock. A modest busy_timeout waits out brief
  // contention synchronously; longer contention is handled by withBusyRetry,
  // which yields the event loop between attempts.
  raw.exec("PRAGMA busy_timeout = 3000");
  if (path !== ":memory:") {
    raw.exec("PRAGMA journal_mode = WAL");
  }
  return new NodeSqliteDb(raw);
}
