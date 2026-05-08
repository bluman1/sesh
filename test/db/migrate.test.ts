import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";

describe("runMigrations", () => {
  it("creates all expected tables on a fresh db", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("sessions");
    expect(names).toContain("tags");
    expect(names).toContain("categories");
    expect(names).toContain("project_remap");
    expect(names).toContain("schema_version");
    db.close();
  });

  it("is idempotent — running twice does nothing extra", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    runMigrations(db);
    const v = db
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get() as { v: number };
    expect(v.v).toBe(3);
    db.close();
  });

  it("recovers a pre-tracking DB: sessions table exists, no schema_version", () => {
    // Reproduces the bug a marketplace user hit: an older Sesh build had
    // already created `sessions` (and the rest of the v1 schema) but didn't
    // record it in schema_version (because schema_version itself was created
    // INSIDE 001_initial.sql). On the next start, runMigrations would try to
    // re-run 001 and fail with "table sessions already exists".
    const db = openDb(":memory:");
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        project_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_mtime INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        auto_title TEXT,
        custom_title TEXT,
        category_id INTEGER,
        notes TEXT,
        favorited INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        orphaned INTEGER NOT NULL DEFAULT 0,
        content_indexed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE tags (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (session_id, tag)
      );
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE project_remap (
        from_path TEXT PRIMARY KEY,
        to_path TEXT NOT NULL
      );
    `);

    expect(() => runMigrations(db)).not.toThrow();

    // v1 should have been auto-recorded, then v2 + v3 applied normally.
    const versions = (
      db
        .prepare("SELECT version FROM schema_version ORDER BY version")
        .all() as { version: number }[]
    ).map((r) => r.version);
    expect(versions).toEqual([1, 2, 3]);

    // The original sessions table is intact (not dropped/recreated).
    const sessionsCol = db
      .prepare("SELECT name FROM pragma_table_info('sessions') WHERE name='id'")
      .get();
    expect(sessionsCol).toBeTruthy();

    // v3 columns landed via the normal migration path.
    const tokensCol = db
      .prepare(
        "SELECT name FROM pragma_table_info('sessions') WHERE name='tokens_in'",
      )
      .get();
    expect(tokensCol).toBeTruthy();

    db.close();
  });

  it("creates schema_version even on a totally fresh DB before running 001", () => {
    // Defensive: 001_initial.sql no longer creates schema_version (the
    // bootstrap step does). Confirm a fresh DB still ends up with the
    // version-tracking table.
    const db = openDb(":memory:");
    runMigrations(db);
    const versionTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
      )
      .get();
    expect(versionTable).toBeTruthy();
    db.close();
  });
});
