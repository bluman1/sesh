import type { TurnRow } from "../db/turns";
import type { ChunkRow, ChunkKind } from "../db/chunks";
import { chunkText } from "../embed/chunkText";

/**
 * Walk every turn in a session and produce text chunks ready for embedding.
 * Chunk text comes from the JSONL via the existing extractTurns plumbing —
 * but turns table doesn't store full text (only text_len). We re-parse the
 * session file to get the actual text, scoped per-turn.
 *
 * For v1: source the text from the assistant turn's text_len > 0 message
 * AND the user turn's content. Tool results are skipped.
 *
 * Implementation: read turn rows for the session, then for each role-bearing
 * turn, fetch the text from the JSONL by turn id. Since extractTurns already
 * runs over the JSONL, the simplest design is to re-run extraction *just*
 * to recover text. To avoid that cost, we'll instead require callers to
 * pass texts alongside turn rows.
 */
export interface TurnWithText {
  turn: TurnRow;
  text: string;
}

export function extractChunksFromTurns(
  turns: TurnWithText[],
  now: number = Date.now(),
): ChunkRow[] {
  const out: ChunkRow[] = [];
  for (const { turn, text } of turns) {
    if (!text || text.trim().length === 0) continue;
    const kind: ChunkKind = turn.role === "user" ? "user_msg" : "turn";
    const pieces = chunkText(text);
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const id = `${turn.id}#${i}`;
      out.push({
        id,
        source_kind: kind,
        source_id: turn.id,
        session_id: turn.session_id,
        position: i,
        text: piece,
        char_count: piece.length,
        created_at: now,
      });
    }
  }
  return out;
}
