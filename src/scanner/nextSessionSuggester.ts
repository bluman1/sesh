import type { Db } from "../db/connection";
import { IdeaRepository } from "../db/ideas";
import { recentCommitments } from "../db/analyticsQueries";

export interface SessionSuggestion {
  kind: "idea" | "commitment";
  text: string;
  weight: number;
  source_session_ids: string[];
}

export function suggestNextSessionTopics(db: Db, opts?: { limit?: number }): SessionSuggestion[] {
  const limit = opts?.limit ?? 5;
  const out: SessionSuggestion[] = [];

  // Idea clusters with size >= 2.
  const ideaRepo = new IdeaRepository(db);
  const clusters = ideaRepo.listClusters().filter((c) => c.size >= 2);
  for (const c of clusters) {
    const head = c.ideas[0];
    if (!head) continue;
    const recency = Math.max(...c.ideas.map((i) => i.detected_at));
    const ageDays = (Date.now() - recency) / (86400 * 1000);
    const weight = c.size / (1 + ageDays * 0.1);
    out.push({
      kind: "idea",
      text: head.text,
      weight,
      source_session_ids: [...new Set(c.ideas.map((i) => i.source_session_id))],
    });
  }

  // Recent commitments.
  let commitmentsList: Array<{ session_id: string; turn_id: string; ts: number; excerpt: string }> = [];
  try {
    commitmentsList = recentCommitments({ db, since: Date.now() - 14 * 86400 * 1000 });
  } catch {
    commitmentsList = [];
  }
  for (const c of commitmentsList) {
    const ageDays = (Date.now() - c.ts) / (86400 * 1000);
    const weight = 1.5 / (1 + ageDays * 0.15);
    out.push({
      kind: "commitment",
      text: c.excerpt,
      weight,
      source_session_ids: [c.session_id],
    });
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, limit);
}
