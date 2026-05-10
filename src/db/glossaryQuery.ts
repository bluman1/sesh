import type { Db } from "./connection";
import { ChunkRepository } from "./chunks";

export interface GlossaryEntry {
  term: string;
  count: number;
  session_count: number;
  example_session_ids: string[];
}

const TERM_PATTERN = /\b(?:[A-Z][a-z]+(?:[A-Z][a-z]+)+|[A-Z]{2,}|[A-Z][a-z]{3,})\b/g;
const FILE_PATTERN = /\b[\w./-]+\.(?:ts|tsx|js|jsx|py|rs|go|md|yml|yaml|json|sql|sh|css|html)\b/g;
const STOPLIST = new Set([
  "Sesh","Claude","Code","Codex","CLI","JSONL","SQLite","TODO","FIXME","Note","NOTE",
  "JS","TS","CSS","HTML","JSON","YAML","API","URL","HTTP","DB","SQL","MIT","UI","UX",
  "Hi","Hello","Yes","No","OK","OK,",
]);

export function computeGlossary(db: Db, opts?: { limit?: number }): GlossaryEntry[] {
  const limit = opts?.limit ?? 50;
  const chunks = new ChunkRepository(db).listAll();

  type Bucket = { count: number; sessionIds: Set<string>; firstSession: string };
  const map = new Map<string, Bucket>();
  for (const c of chunks) {
    const seen = new Set<string>();
    const collect = (re: RegExp) => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(c.text)) !== null) {
        const term = m[0];
        if (STOPLIST.has(term)) continue;
        if (term.length < 3) continue;
        if (seen.has(term)) continue;
        seen.add(term);
        let bucket = map.get(term);
        if (!bucket) { bucket = { count: 0, sessionIds: new Set(), firstSession: c.session_id }; map.set(term, bucket); }
        bucket.count++;
        bucket.sessionIds.add(c.session_id);
      }
    };
    collect(TERM_PATTERN);
    collect(FILE_PATTERN);
  }

  return [...map.entries()]
    .filter(([, b]) => b.count >= 3)
    .map(([term, b]) => ({
      term,
      count: b.count,
      session_count: b.sessionIds.size,
      example_session_ids: [...b.sessionIds].slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
