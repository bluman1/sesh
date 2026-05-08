import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { TagRepository } from "../../src/db/tags";
import { SessionRepository } from "../../src/db/sessions";

describe("TagRepository", () => {
  let db: Db;
  let tags: TagRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    new SessionRepository(db).upsert({
      id: "s1",
      source: "claude-code",
      project_path: "/p",
      file_path: "/f",
      file_mtime: 0,
      file_size: 0,
      created_at: 0,
      last_active_at: 0,
      message_count: 0,
      auto_title: null,
      custom_title: null,
      category_id: null,
      notes: null,
      favorited: 0,
      archived: 0,
      orphaned: 0,
      content_indexed: 0,
    });
    tags = new TagRepository(db);
  });

  it("setTags replaces the full tag set", () => {
    tags.setTags("s1", ["a", "b"]);
    expect(tags.getTags("s1").sort()).toEqual(["a", "b"]);
    tags.setTags("s1", ["b", "c"]);
    expect(tags.getTags("s1").sort()).toEqual(["b", "c"]);
  });

  it("listAllTags returns distinct tags across sessions", () => {
    tags.setTags("s1", ["x", "y"]);
    expect(tags.listAllTags().sort()).toEqual(["x", "y"]);
  });
});
