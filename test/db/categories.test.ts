import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { CategoryRepository } from "../../src/db/categories";

describe("CategoryRepository", () => {
  let db: Db;
  let cats: CategoryRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    cats = new CategoryRepository(db);
  });

  it("create returns a new category with an id", () => {
    const c = cats.create({ name: "Work", color: "#ff0000", sort_order: 0 });
    expect(c.id).toBeGreaterThan(0);
    expect(c.name).toBe("Work");
  });

  it("listAll returns categories ordered by sort_order then name", () => {
    cats.create({ name: "B", color: null, sort_order: 1 });
    cats.create({ name: "A", color: null, sort_order: 0 });
    cats.create({ name: "C", color: null, sort_order: 0 });
    const names = cats.listAll().map((c) => c.name);
    expect(names).toEqual(["A", "C", "B"]);
  });

  it("rename updates the name", () => {
    const c = cats.create({ name: "Old", color: null, sort_order: 0 });
    cats.rename(c.id, "New");
    expect(cats.listAll()[0].name).toBe("New");
  });

  it("delete removes the row", () => {
    const c = cats.create({ name: "Tmp", color: null, sort_order: 0 });
    cats.delete(c.id);
    expect(cats.listAll()).toEqual([]);
  });
});
