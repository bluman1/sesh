import * as fs from "node:fs";
import type { Db } from "../db/connection";
import { ChunkRepository } from "../db/chunks";

export interface StyleFingerprint {
  generated_at: number;
  source_session_count: number;
  source_chunk_count: number;
  total_chars: number;
  avg_user_chars_per_turn: number;
  avg_words_per_sentence: number;
  hedging_per_1000_words: number;
  exclamation_per_1000_chars: number;
  capital_letter_rate: number;
  top_tokens: { token: string; tfidf: number }[];
  question_rate_pct: number;
  code_block_rate_pct: number;
  politeness_per_1000_words: number;
  vocab_richness: number;
  top_openings: { phrase: string; count: number }[];
}

const HEDGES = [
  "maybe", "kinda", "sorta", "i think", "sort of", "kind of",
  "perhaps", "probably", "might be", "i guess", "i suppose",
];
const STOPWORDS = new Set([
  "a","the","an","and","or","but","is","are","was","were","be","being","been",
  "to","of","in","on","at","for","with","by","as","from","that","this","these","those",
  "i","you","we","he","she","it","they","my","your","our","his","her","their","its",
  "do","does","did","done","have","has","had","will","would","can","could","should","may","might",
  "if","else","when","then","than","so","not","no","yes","ok",
]);

export function computeStyleFingerprint(db: Db, opts?: { sinceDays?: number }): StyleFingerprint {
  const sinceMs = opts?.sinceDays !== undefined
    ? Date.now() - opts.sinceDays * 86400 * 1000
    : 0;

  const chunks = new ChunkRepository(db).listAll().filter(
    (c) => c.source_kind === "user_msg" && c.created_at >= sinceMs && c.text.trim().length > 0,
  );

  if (chunks.length === 0) {
    return {
      generated_at: Date.now(),
      source_session_count: 0,
      source_chunk_count: 0,
      total_chars: 0,
      avg_user_chars_per_turn: 0,
      avg_words_per_sentence: 0,
      hedging_per_1000_words: 0,
      exclamation_per_1000_chars: 0,
      capital_letter_rate: 0,
      top_tokens: [],
      question_rate_pct: 0,
      code_block_rate_pct: 0,
      politeness_per_1000_words: 0,
      vocab_richness: 0,
      top_openings: [],
    };
  }

  const QUESTION_START_RE = /^(what|how|why|when|where|who|can|could|should|would|will|do|does|is|are)\b/i;
  const CODE_BLOCK_RE = /```[\s\S]*?```/;
  const POLITENESS_RE = /\b(please|thanks|thank you|thx|thank you so much)\b/gi;

  const sessionIds = new Set(chunks.map((c) => c.session_id));
  let totalChars = 0;
  let totalWords = 0;
  let totalSentences = 0;
  let totalHedges = 0;
  let totalExclamations = 0;
  let totalAlpha = 0;
  let totalCaps = 0;
  let totalQuestions = 0;
  let totalCodeBlocks = 0;
  let totalPoliteness = 0;

  // Token frequencies per chunk for tf-idf.
  const docFreq = new Map<string, number>();
  const docTokens: Map<string, number>[] = [];
  const openingCounts = new Map<string, number>();

  for (const c of chunks) {
    const text = c.text;
    totalChars += text.length;
    totalSentences += Math.max(1, (text.match(/[.!?]+/g) || []).length);
    const words = text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
    totalWords += words.length;
    for (const h of HEDGES) {
      const re = new RegExp(`\\b${h.replace(/ /g, "\\s+")}\\b`, "gi");
      totalHedges += (text.match(re) || []).length;
    }
    totalExclamations += (text.match(/!/g) || []).length;
    for (const ch of text) {
      if (/[a-zA-Z]/.test(ch)) {
        totalAlpha++;
        if (ch >= "A" && ch <= "Z") totalCaps++;
      }
    }
    // Question rate
    const trimmed = text.trim();
    if (trimmed.endsWith("?") || QUESTION_START_RE.test(trimmed)) {
      totalQuestions++;
    }
    // Code block rate
    if (CODE_BLOCK_RE.test(text)) {
      totalCodeBlocks++;
    }
    // Politeness
    const polMatches = text.match(POLITENESS_RE);
    if (polMatches) totalPoliteness += polMatches.length;
    // Top openings: first 3 words
    const openWords = text.trim().toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean).slice(0, 3);
    if (openWords.length === 3) {
      const phrase = openWords.join(" ");
      openingCounts.set(phrase, (openingCounts.get(phrase) ?? 0) + 1);
    }
    const tokenCount = new Map<string, number>();
    for (const w of words) {
      if (STOPWORDS.has(w) || w.length < 3) continue;
      tokenCount.set(w, (tokenCount.get(w) ?? 0) + 1);
    }
    docTokens.push(tokenCount);
    for (const t of tokenCount.keys()) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }

  const N = docTokens.length;
  const tfidfTotals = new Map<string, number>();
  let totalNonStopTokens = 0;
  for (const tokens of docTokens) {
    const docLen = [...tokens.values()].reduce((s, n) => s + n, 0) || 1;
    totalNonStopTokens += docLen;
    for (const [token, count] of tokens) {
      const tf = count / docLen;
      const df = docFreq.get(token) ?? 1;
      const idf = Math.log(N / df) + 1;
      tfidfTotals.set(token, (tfidfTotals.get(token) ?? 0) + tf * idf);
    }
  }
  const top = [...tfidfTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([token, tfidf]) => ({ token, tfidf }));

  // Vocab richness: unique non-stopword tokens / total non-stopword tokens
  const vocabRichness = totalNonStopTokens === 0 ? 0 :
    Math.round((docFreq.size / totalNonStopTokens) * 1000) / 1000;

  // Top openings: phrases appearing >= 2 times, sorted by count desc, top 10
  const topOpenings = [...openingCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }));

  return {
    generated_at: Date.now(),
    source_session_count: sessionIds.size,
    source_chunk_count: chunks.length,
    total_chars: totalChars,
    avg_user_chars_per_turn: Math.round(totalChars / chunks.length),
    avg_words_per_sentence: Math.round((totalWords / totalSentences) * 10) / 10,
    hedging_per_1000_words: Math.round((totalHedges * 1000 / Math.max(1, totalWords)) * 10) / 10,
    exclamation_per_1000_chars: Math.round((totalExclamations * 1000 / Math.max(1, totalChars)) * 10) / 10,
    capital_letter_rate: totalAlpha === 0 ? 0 : Math.round((totalCaps / totalAlpha) * 1000) / 1000,
    top_tokens: top,
    question_rate_pct: Math.round((totalQuestions / chunks.length) * 1000) / 10,
    code_block_rate_pct: Math.round((totalCodeBlocks / chunks.length) * 1000) / 10,
    politeness_per_1000_words: Math.round((totalPoliteness * 1000 / Math.max(1, totalWords)) * 10) / 10,
    vocab_richness: vocabRichness,
    top_openings: topOpenings,
  };
}

export function exportFingerprintToFile(fp: StyleFingerprint, path: string): void {
  fs.writeFileSync(path, JSON.stringify(fp, null, 2), "utf8");
}
