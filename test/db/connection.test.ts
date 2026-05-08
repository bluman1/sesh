import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/connection";

describe("openDb", () => {
  it("opens an in-memory database with WAL mode disabled gracefully (in-memory does not support WAL)", () => {
    const db = openDb(":memory:");
    expect(db.open).toBe(true);
    db.close();
  });

  it("opens a file-backed database with WAL mode enabled", (ctx) => {
    const tmp = `/tmp/sesh-test-${ctx.task.id}.sqlite`;
    const db = openDb(tmp);
    const row = db.pragma("journal_mode", { simple: true });
    expect(row).toBe("wal");
    db.close();
  });
});
