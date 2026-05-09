import type { Db } from "../db/connection";
import { OutcomeRepository } from "../db/outcomes";

export interface InferOpts {
  db: Db;
  now: number;
  windowDays: number;
}

export function inferOutcomes(opts: InferOpts): void {
  const outcomes = new OutcomeRepository(opts.db);
  const cutoff = opts.now - opts.windowDays * 86400 * 1000;
  const rows = opts.db
    .prepare(
      "SELECT id, last_active_at FROM sessions WHERE archived = 0 AND orphaned = 0",
    )
    .all() as { id: string; last_active_at: number }[];
  for (const r of rows) {
    const state = r.last_active_at < cutoff ? "abandoned" : "open";
    outcomes.setInferred(r.id, state);
  }
}
