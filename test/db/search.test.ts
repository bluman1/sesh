import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { TagRepository } from "../../src/db/tags";
import { CategoryRepository } from "../../src/db/categories";
import {
  searchSessions,
  countSessionsInScope,
  type SearchFilters,
} from "../../src/db/search";

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
    tokens_in: 0,
    tokens_out: 0,
    tokens_cache_read: 0,
    tokens_cache_create: 0,
    turns_indexed: 0 as 0|1,
    turns_last_offset: 0,
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

  it("scope=current includes remapped paths", () => {
    repo.upsert(baseRow("a", { project_path: "/old/path" }));
    repo.upsert(baseRow("b", { project_path: "/new/path" }));
    repo.upsert(baseRow("c", { project_path: "/other" }));
    repo.addRemap("/old/path", "/new/path");
    const result = searchSessions(db, {
      ...NEUTRAL,
      scope: "current",
      currentPath: "/new/path",
    });
    expect(result.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("scope=current with no currentPath returns [] instead of falling through", () => {
    repo.upsert(baseRow("a", { project_path: "/p1" }));
    repo.upsert(baseRow("b", { project_path: "/p2" }));
    expect(
      searchSessions(db, { ...NEUTRAL, scope: "current", currentPath: null }),
    ).toEqual([]);
  });

  it("scope=folder filters by selectedFolderPath", () => {
    repo.upsert(baseRow("a", { project_path: "/p1" }));
    repo.upsert(baseRow("b", { project_path: "/p2" }));
    expect(
      searchSessions(db, {
        ...NEUTRAL,
        scope: "folder",
        selectedFolderPath: "/p1",
      }).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("scope=folder with no selectedFolderPath returns []", () => {
    repo.upsert(baseRow("a", { project_path: "/p1" }));
    expect(
      searchSessions(db, {
        ...NEUTRAL,
        scope: "folder",
        selectedFolderPath: null,
      }),
    ).toEqual([]);
  });
});

describe("countSessionsInScope", () => {
  let db: Db;
  let repo: SessionRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    repo = new SessionRepository(db);
  });

  it("counts every session when scope=all", () => {
    repo.upsert(baseRow("a", { project_path: "/p1" }));
    repo.upsert(baseRow("b", { project_path: "/p2" }));
    expect(
      countSessionsInScope(db, {
        scope: "all",
        currentPath: null,
        selectedFolderPath: null,
      }),
    ).toBe(2);
  });

  it("ignores query/chip filters — only scope is honored", () => {
    repo.upsert(baseRow("a", { archived: 1 }));
    repo.upsert(baseRow("b", { favorited: 1 }));
    repo.upsert(baseRow("c"));
    // Even though searchSessions with archived=false would return 2 rows,
    // the scope-only count counts everything in the container.
    expect(
      countSessionsInScope(db, {
        scope: "all",
        currentPath: null,
        selectedFolderPath: null,
      }),
    ).toBe(3);
  });

  it("scope=current narrows to currentPath", () => {
    repo.upsert(baseRow("a", { project_path: "/p1" }));
    repo.upsert(baseRow("b", { project_path: "/p1" }));
    repo.upsert(baseRow("c", { project_path: "/p2" }));
    expect(
      countSessionsInScope(db, {
        scope: "current",
        currentPath: "/p1",
        selectedFolderPath: null,
      }),
    ).toBe(2);
  });

  it("scope=current with null currentPath returns 0", () => {
    repo.upsert(baseRow("a", { project_path: "/p1" }));
    expect(
      countSessionsInScope(db, {
        scope: "current",
        currentPath: null,
        selectedFolderPath: null,
      }),
    ).toBe(0);
  });

  it("scope=folder narrows to selectedFolderPath", () => {
    repo.upsert(baseRow("a", { project_path: "/p1" }));
    repo.upsert(baseRow("b", { project_path: "/p2" }));
    expect(
      countSessionsInScope(db, {
        scope: "folder",
        currentPath: null,
        selectedFolderPath: "/p1",
      }),
    ).toBe(1);
  });

  it("scope=folder with null selectedFolderPath returns 0", () => {
    repo.upsert(baseRow("a", { project_path: "/p1" }));
    expect(
      countSessionsInScope(db, {
        scope: "folder",
        currentPath: null,
        selectedFolderPath: null,
      }),
    ).toBe(0);
  });

  it("includes remapped from_paths in scope=current", () => {
    repo.upsert(baseRow("a", { project_path: "/old/path" }));
    repo.upsert(baseRow("b", { project_path: "/new/path" }));
    repo.upsert(baseRow("c", { project_path: "/other" }));
    repo.addRemap("/old/path", "/new/path");
    expect(
      countSessionsInScope(db, {
        scope: "current",
        currentPath: "/new/path",
        selectedFolderPath: null,
      }),
    ).toBe(2);
  });
});
