import type { Db } from "./connection";

export class TagRepository {
  constructor(private db: Db) {}

  getTags(sessionId: string): string[] {
    return (
      this.db.prepare("SELECT tag FROM tags WHERE session_id = ?").all(sessionId) as {
        tag: string;
      }[]
    ).map((r) => r.tag);
  }

  setTags(sessionId: string, tags: string[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM tags WHERE session_id = ?").run(sessionId);
      const insert = this.db.prepare(
        "INSERT INTO tags (session_id, tag) VALUES (?, ?)",
      );
      for (const t of tags) insert.run(sessionId, t);
    });
    tx();
  }

  listAllTags(): string[] {
    return (
      this.db.prepare("SELECT DISTINCT tag FROM tags ORDER BY tag").all() as {
        tag: string;
      }[]
    ).map((r) => r.tag);
  }
}
