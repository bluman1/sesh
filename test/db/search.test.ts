import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { TagRepository } from "../../src/db/tags";
import { CategoryRepository } from "../../src/db/categories";
import { searchSessions, type SearchFilters } from "../../src/db/search";

function baseRow(id: string, overrides: Partial<{
  project_path: string; favorited: 0|1; archived: 0|1;
  custom_title: string|null; notes: string|null; category_id: number|null;
  last_active_at: number;
}> = {}) {
  return {
    id,
    source: "claude-code",
    project_path: "/p",
    file_path: `/f/${id}.jsonl`,
    file_mtime: 0,
    file_size: 0,
    created_at: 0,
    last_active_at: 0,
    message_count: 0,
    auto_title: null,
    custom_title: null,
    category_id: null,
    notes: null,
    favorited: 0 as 0|1,
    archived: 0 as 0|1,
    orphaned: 0 as 0|1,
    content_indexed: 0 as 0|1,
    last_parsed_offset: 0,
    ...overrides,
  };
}

const NEUTRAL: SearchFilters = {
  scope: "all",
  currentPath: null,
  query: "",
  category_ids: [],
  tags: [],
  favorited: null,
  archived: null,
};

describe("searchSessions", () => {
  let db: Db;
  let repo: SessionRepository;
  let tags: TagRepository;
  let cats: CategoryRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    repo = new SessionRepository(db);
    tags = new TagRepository(db);
    cats = new CategoryRepository(db);
  });

  it("returns all when no filters", () => {
    repo.upsert(baseRow("a"));
    repo.upsert(baseRow("b"));
    const result = searchSessions(db, NEUTRAL);
    expect(result.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("filters by archived state", () => {
    repo.upsert(baseRow("a", { archived: 1 }));
    repo.upsert(baseRow("b"));
    expect(searchSessions(db, { ...NEUTRAL, archived: false }).map((r) => r.id)).toEqual(["b"]);
    expect(searchSessions(db, { ...NEUTRAL, archived: true }).map((r) => r.id)).toEqual(["a"]);
  });

  it("filters by favorited", () => {
    repo.upsert(baseRow("a", { favorited: 1 }));
    repo.upsert(baseRow("b"));
    expect(searchSessions(db, { ...NEUTRAL, favorited: true }).map((r) => r.id)).toEqual(["a"]);
  });

  it("filters by current scope and path", () => {
    repo.upsert(baseRow("a", { project_path: "/p1" }));
    repo.upsert(baseRow("b", { project_path: "/p2" }));
    expect(
      searchSessions(db, { ...NEUTRAL, scope: "current", currentPath: "/p1" }).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("filters by category_ids", () => {
    const cat1 = cats.create({ name: "Work", color: null, sort_order: 0 });
    const cat2 = cats.create({ name: "Bug", color: null, sort_order: 0 });
    repo.upsert(baseRow("a", { category_id: cat1.id }));
    repo.upsert(baseRow("b", { category_id: cat2.id }));
    repo.upsert(baseRow("c"));
    expect(
      searchSessions(db, { ...NEUTRAL, category_ids: [cat1.id] }).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("filters by tags (AND semantics)", () => {
    repo.upsert(baseRow("a"));
    repo.upsert(baseRow("b"));
    repo.upsert(baseRow("c"));
    tags.setTags("a", ["x", "y"]);
    tags.setTags("b", ["x"]);
    tags.setTags("c", ["y"]);
    expect(
      searchSessions(db, { ...NEUTRAL, tags: ["x"] }).map((r) => r.id).sort(),
    ).toEqual(["a", "b"]);
    expect(
      searchSessions(db, { ...NEUTRAL, tags: ["x", "y"] }).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("matches query against title and notes", () => {
    repo.upsert(baseRow("a", { custom_title: "Auth refactor" }));
    repo.upsert(baseRow("b", { notes: "billing webhook investigation" }));
    repo.upsert(baseRow("c"));
    expect(searchSessions(db, { ...NEUTRAL, query: "auth" }).map((r) => r.id)).toEqual(["a"]);
    expect(searchSessions(db, { ...NEUTRAL, query: "billing" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("matches query against tags", () => {
    repo.upsert(baseRow("a"));
    repo.upsert(baseRow("b"));
    tags.setTags("a", ["auth-refactor"]);
    expect(searchSessions(db, { ...NEUTRAL, query: "auth" }).map((r) => r.id)).toEqual(["a"]);
  });

  it("matches query against FTS content when indexed", () => {
    repo.upsert(baseRow("a"));
    db.prepare(
      "INSERT INTO session_content_fts (session_id, content) VALUES (?, ?)",
    ).run("a", "hello world this is a deep dive into authentication systems");
    expect(searchSessions(db, { ...NEUTRAL, query: "authentication" }).map((r) => r.id)).toEqual(["a"]);
  });
});
