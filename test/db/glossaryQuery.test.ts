import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { SessionRepository } from "../../src/db/sessions";
import { ChunkRepository } from "../../src/db/chunks";
import { computeGlossary } from "../../src/db/glossaryQuery";

function makeSession(id: string) {
  return {
    id,
    source: "claude-code",
    project_path: `/p/${id}`,
    file_path: `/p/${id}/session.jsonl`,
    file_mtime: 0,
    file_size: 0,
    created_at: 0,
    last_active_at: 0,
    message_count: 1,
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
    repo_path: null,
  };
}

function seedChunk(
  chunkRepo: ChunkRepository,
  id: string,
  sessionId: string,
  text: string,
) {
  chunkRepo.upsertMany([
    {
      id,
      source_kind: "turn",
      source_id: id,
      session_id: sessionId,
      position: 0,
      text,
      char_count: text.length,
      created_at: Date.now(),
    },
  ]);
}

describe("computeGlossary", () => {
  let db: Db;
  let sessionRepo: SessionRepository;
  let chunkRepo: ChunkRepository;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    sessionRepo = new SessionRepository(db);
    chunkRepo = new ChunkRepository(db);
  });

  it("returns [] when no chunks exist", () => {
    const entries = computeGlossary(db);
    expect(entries).toEqual([]);
  });

  it("counts Paperclip across multiple sessions and chunks", () => {
    sessionRepo.upsert(makeSession("s1"));
    sessionRepo.upsert(makeSession("s2"));

    // "Paperclip" matches TERM_PATTERN ([A-Z][a-z]{3,}) — it's not in STOPLIST
    // seed 4 chunks: 2 in s1, 2 in s2 — each mentioning Paperclip once per chunk
    seedChunk(chunkRepo, "c1", "s1", "Paperclip is a task management system we use.");
    seedChunk(chunkRepo, "c2", "s1", "Today I worked on Paperclip integration.");
    seedChunk(chunkRepo, "c3", "s2", "Paperclip has a REST API worth studying.");
    seedChunk(chunkRepo, "c4", "s2", "I submitted Paperclip task updates today.");

    const entries = computeGlossary(db);
    const paperclip = entries.find((e) => e.term === "Paperclip");

    expect(paperclip).toBeDefined();
    expect(paperclip!.count).toBe(4);
    expect(paperclip!.session_count).toBe(2);
    expect(paperclip!.example_session_ids).toContain("s1");
    expect(paperclip!.example_session_ids).toContain("s2");
  });

  it("counts file paths via FILE_PATTERN", () => {
    sessionRepo.upsert(makeSession("s1"));
    sessionRepo.upsert(makeSession("s2"));

    // "src/foo.ts" matches FILE_PATTERN
    seedChunk(chunkRepo, "c1", "s1", "See the file src/foo.ts for details.");
    seedChunk(chunkRepo, "c2", "s1", "I updated src/foo.ts yesterday too.");
    seedChunk(chunkRepo, "c3", "s2", "src/foo.ts needs a refactor soon.");

    const entries = computeGlossary(db);
    const fooTs = entries.find((e) => e.term === "src/foo.ts");

    expect(fooTs).toBeDefined();
    expect(fooTs!.count).toBe(3);
    expect(fooTs!.session_count).toBe(2);
  });

  it("filters out terms with count < 3", () => {
    sessionRepo.upsert(makeSession("s1"));

    // "Zephyr" appears only twice — should be excluded
    seedChunk(chunkRepo, "c1", "s1", "Zephyr is a tool we considered.");
    seedChunk(chunkRepo, "c2", "s1", "Zephyr was mentioned in the meeting.");

    const entries = computeGlossary(db);
    expect(entries.find((e) => e.term === "Zephyr")).toBeUndefined();
  });

  it("respects limit option", () => {
    sessionRepo.upsert(makeSession("s1"));

    // Seed many distinct terms that each appear >= 3 times
    const terms = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
    for (const t of terms) {
      for (let i = 0; i < 3; i++) {
        seedChunk(chunkRepo, `${t}-c${i}`, "s1", `${t} is used in the project extensively here.`);
      }
    }

    const entries = computeGlossary(db, { limit: 2 });
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it("deduplicates term occurrences within the same chunk", () => {
    sessionRepo.upsert(makeSession("s1"));
    sessionRepo.upsert(makeSession("s2"));
    sessionRepo.upsert(makeSession("s3"));

    // "Kestrel" appears twice in one chunk — should only be counted once per chunk
    seedChunk(chunkRepo, "c1", "s1", "Kestrel and Kestrel again appear here.");
    seedChunk(chunkRepo, "c2", "s2", "Kestrel is mentioned in session two.");
    seedChunk(chunkRepo, "c3", "s3", "Kestrel appears in session three too.");

    const entries = computeGlossary(db);
    const kestrel = entries.find((e) => e.term === "Kestrel");

    expect(kestrel).toBeDefined();
    // Count should be 3 (one per chunk, deduplicated within chunk)
    expect(kestrel!.count).toBe(3);
  });
});
