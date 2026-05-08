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
    expect(v.v).toBe(1);
    db.close();
  });
});
