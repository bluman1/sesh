import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";

describe("project_remap CRUD on SessionRepository", () => {
  let db: Db;
  let repo: SessionRepository;
  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    repo = new SessionRepository(db);
  });

  it("addRemap inserts a row", () => {
    repo.addRemap("/old", "/new");
    expect(repo.listRemaps()).toEqual([{ from_path: "/old", to_path: "/new" }]);
  });

  it("addRemap on existing from_path replaces to_path", () => {
    repo.addRemap("/old", "/new");
    repo.addRemap("/old", "/newer");
    expect(repo.listRemaps()).toEqual([{ from_path: "/old", to_path: "/newer" }]);
  });

  it("removeRemap removes a row", () => {
    repo.addRemap("/old", "/new");
    repo.removeRemap("/old");
    expect(repo.listRemaps()).toEqual([]);
  });
});
