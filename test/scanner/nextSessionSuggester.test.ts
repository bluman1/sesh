import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { IdeaRepository } from "../../src/db/ideas";
import { suggestNextSessionTopics } from "../../src/scanner/nextSessionSuggester";

function makeSession(id: string, lastActiveAt = Date.now()) {
  return {
    id,
    source: "claude-code" as const,
    project_path: "/tmp/proj",
    file_path: "/tmp/proj/session.jsonl",
    file_mtime: 0,
    file_size: 0,
    created_at: 0,
    last_active_at: lastActiveAt,
    message_count: 2,
    auto_title: null,
    custom_title: null,
    category_id: null,
    notes: null,
    favorited: 0 as const,
    archived: 0 as const,
    orphaned: 0 as const,
    content_indexed: 0 as const,
    last_parsed_offset: 0,
    tokens_in: 0,
    tokens_out: 0,
    tokens_cache_read: 0,
    tokens_cache_create: 0,
    turns_indexed: 1 as const,
    turns_last_offset: 0,
  };
}

function makeIdea(
  id: string,
  clusterId: string,
  text: string,
  sessionId: string,
  detectedAt = Date.now(),
) {
  return {
    id,
    cluster_id: clusterId,
    text,
    source_session_id: sessionId,
    source_turn_id: null,
    detected_at: detectedAt,
    confidence: 0.9,
    status: "open" as const,
  };
}

describe("suggestNextSessionTopics", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let ideaRepo: IdeaRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    ideaRepo = new IdeaRepository(db);

    sessionRepo.upsert(makeSession("s1"));
    sessionRepo.upsert(makeSession("s2"));
    sessionRepo.upsert(makeSession("s3"));
  });

  it("returns an empty array when no ideas and no commitments exist", () => {
    const suggestions = suggestNextSessionTopics(db);
    expect(suggestions).toHaveLength(0);
  });

  it("includes idea suggestions from clusters with size >= 2", () => {
    const now = Date.now();
    // Cluster "cl1" has size 2 — should be included.
    ideaRepo.upsertMany([
      makeIdea("i1", "cl1", "Refactor the auth module", "s1", now),
      makeIdea("i2", "cl1", "Refactor the auth module again", "s2", now),
    ]);

    const suggestions = suggestNextSessionTopics(db);
    const ideaSuggestions = suggestions.filter((s) => s.kind === "idea");
    expect(ideaSuggestions.length).toBeGreaterThanOrEqual(1);
    expect(ideaSuggestions[0].text).toBe("Refactor the auth module");
  });

  it("excludes idea clusters with size < 2", () => {
    const now = Date.now();
    // Cluster "cl-single" has only 1 idea — should NOT appear.
    ideaRepo.upsertMany([
      makeIdea("i-lone", "cl-single", "A one-off idea", "s1", now),
    ]);

    const suggestions = suggestNextSessionTopics(db);
    const ideaSuggestions = suggestions.filter((s) => s.kind === "idea");
    expect(ideaSuggestions).toHaveLength(0);
  });

  it("returns suggestions sorted by weight descending", () => {
    const now = Date.now();
    // cl1 has size 3 (higher weight), cl2 has size 2 (lower weight).
    ideaRepo.upsertMany([
      makeIdea("i1", "cl1", "Big cluster idea one", "s1", now),
      makeIdea("i2", "cl1", "Big cluster idea two", "s2", now),
      makeIdea("i3", "cl1", "Big cluster idea three", "s3", now),
      makeIdea("i4", "cl2", "Small cluster idea one", "s1", now),
      makeIdea("i5", "cl2", "Small cluster idea two", "s2", now),
    ]);

    const suggestions = suggestNextSessionTopics(db);
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1].weight).toBeGreaterThanOrEqual(suggestions[i].weight);
    }
  });

  it("respects the limit option", () => {
    const now = Date.now();
    // Create 5 clusters of size 2.
    for (let c = 0; c < 5; c++) {
      ideaRepo.upsertMany([
        makeIdea(`i${c}a`, `cl${c}`, `Idea cluster ${c} item a`, "s1", now),
        makeIdea(`i${c}b`, `cl${c}`, `Idea cluster ${c} item b`, "s2", now),
      ]);
    }
    const suggestions = suggestNextSessionTopics(db, { limit: 3 });
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it("includes commitment suggestions from FTS content", () => {
    // Insert FTS content that matches a commitment pattern.
    db.prepare("INSERT INTO session_content_fts (session_id, content) VALUES (?, ?)").run(
      "s1",
      "TODO: fix the login button alignment on mobile screens",
    );

    const suggestions = suggestNextSessionTopics(db);
    const commitmentSuggestions = suggestions.filter((s) => s.kind === "commitment");
    expect(commitmentSuggestions.length).toBeGreaterThanOrEqual(1);
  });

  it("returns both idea and commitment kinds when both exist", () => {
    const now = Date.now();
    ideaRepo.upsertMany([
      makeIdea("i1", "cl1", "Multi-source idea alpha", "s1", now),
      makeIdea("i2", "cl1", "Multi-source idea beta", "s2", now),
    ]);
    db.prepare("INSERT INTO session_content_fts (session_id, content) VALUES (?, ?)").run(
      "s1",
      "TODO: write integration tests for the payment flow",
    );

    const suggestions = suggestNextSessionTopics(db, { limit: 10 });
    const kinds = new Set(suggestions.map((s) => s.kind));
    expect(kinds.has("idea")).toBe(true);
    expect(kinds.has("commitment")).toBe(true);
  });

  it("populates source_session_ids for idea suggestions", () => {
    const now = Date.now();
    ideaRepo.upsertMany([
      makeIdea("i1", "cl1", "Cross-session idea", "s1", now),
      makeIdea("i2", "cl1", "Cross-session idea duplicate", "s2", now),
    ]);

    const suggestions = suggestNextSessionTopics(db);
    const ideaSuggestion = suggestions.find((s) => s.kind === "idea");
    expect(ideaSuggestion).toBeDefined();
    expect(ideaSuggestion!.source_session_ids.length).toBeGreaterThanOrEqual(1);
  });
});
