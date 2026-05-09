import type { Db } from "./connection";

export type OutcomeState =
  | "open"
  | "shipped"
  | "shipped-partial"
  | "reverted"
  | "abandoned";

export interface OutcomeRow {
  session_id: string;
  state: OutcomeState;
  state_inferred_at: number;
  user_marked: 0 | 1;
  notes: string | null;
}

export class OutcomeRepository {
  constructor(private db: Db) {}

  setInferred(sessionId: string, state: OutcomeState): void {
    // Don't overwrite a user-marked outcome; user wins.
    const existing = this.getForSession(sessionId);
    if (existing && existing.user_marked === 1) return;
    this.db
      .prepare(
        `INSERT INTO session_outcomes (session_id, state, state_inferred_at, user_marked, notes)
         VALUES (?, ?, ?, 0, NULL)
         ON CONFLICT(session_id) DO UPDATE SET
           state = excluded.state,
           state_inferred_at = excluded.state_inferred_at,
           user_marked = 0`,
      )
      .run(sessionId, state, Date.now());
  }

  setUser(sessionId: string, state: OutcomeState, notes: string | null): void {
    this.db
      .prepare(
        `INSERT INTO session_outcomes (session_id, state, state_inferred_at, user_marked, notes)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           state = excluded.state,
           state_inferred_at = excluded.state_inferred_at,
           user_marked = 1,
           notes = excluded.notes`,
      )
      .run(sessionId, state, Date.now(), notes);
  }

  getForSession(sessionId: string): OutcomeRow | null {
    const row = this.db
      .prepare(
        "SELECT session_id, state, state_inferred_at, user_marked, notes FROM session_outcomes WHERE session_id = ?",
      )
      .get(sessionId) as OutcomeRow | undefined;
    return row ?? null;
  }

  listByState(state: OutcomeState): OutcomeRow[] {
    return this.db
      .prepare(
        "SELECT session_id, state, state_inferred_at, user_marked, notes FROM session_outcomes WHERE state = ?",
      )
      .all(state) as OutcomeRow[];
  }
}
