export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface RankResult {
  idx: number;
  score: number;
}

export function rankByCosine(
  query: Float32Array,
  candidates: Float32Array[],
  limit?: number,
): RankResult[] {
  const scored: RankResult[] = candidates.map((v, idx) => ({
    idx,
    score: cosineSim(query, v),
  }));
  scored.sort((a, b) => b.score - a.score);
  return limit !== undefined ? scored.slice(0, limit) : scored;
}
