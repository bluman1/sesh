const PATTERNS: { regex: RegExp; weight: number }[] = [
  { regex: /\b(?:i (?:should|need to|want to|could|might|will))\b/gi, weight: 0.8 },
  { regex: /\b(?:we (?:should|could|might|need to|will))\b/gi, weight: 0.7 },
  { regex: /\b(?:todo|fixme)\b/gi, weight: 0.9 },
  { regex: /\b(?:maybe (?:later|next time|eventually))\b/gi, weight: 0.8 },
  { regex: /\b(?:next session|next time|let's eventually|down the line)\b/gi, weight: 0.7 },
  { regex: /\b(?:idea|wondering if|thinking about|what if we)\b/gi, weight: 0.5 },
  { regex: /\b(?:come back to|revisit|defer)\b/gi, weight: 0.6 },
];

const MAX_LEN = 240;
const MIN_LEN = 20;

export interface DetectedIdea {
  text: string;
  confidence: number;
}

/**
 * Scan a user-message text for intent-bearing sentences. Returns one
 * DetectedIdea per matching sentence (deduped). Confidence = pattern weight,
 * capped at 1.0, slightly boosted when multiple patterns match the same
 * sentence.
 */
export function detectIdeas(text: string): DetectedIdea[] {
  if (!text || text.length < MIN_LEN) return [];
  // Split on sentence-like boundaries, keeping the punctuation.
  const sentences = text
    .split(/(?<=[.!?\n])\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_LEN && s.length <= MAX_LEN);

  const seen = new Set<string>();
  const out: DetectedIdea[] = [];
  for (const s of sentences) {
    let totalWeight = 0;
    let matchCount = 0;
    for (const { regex, weight } of PATTERNS) {
      regex.lastIndex = 0;
      if (regex.test(s)) {
        totalWeight += weight;
        matchCount++;
      }
    }
    if (matchCount === 0) continue;
    const confidence = Math.min(1, totalWeight / Math.max(1, matchCount) + (matchCount - 1) * 0.05);
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: s, confidence });
  }
  return out;
}
