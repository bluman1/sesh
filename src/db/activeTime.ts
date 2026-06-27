/** Idle cap: gaps between turns longer than this count as "stepped away". */
export const ACTIVE_IDLE_CAP_MS = 30 * 60_000;

/**
 * Estimate active working time from turn timestamps (UNIX ms): sum each
 * consecutive gap that is <= capMs. Gaps over the cap are excluded; a single
 * turn or empty input is 0. Input may be unsorted.
 */
export function activeMsFromTimestamps(
  tsMs: number[],
  capMs: number = ACTIVE_IDLE_CAP_MS,
): number {
  if (tsMs.length < 2) return 0;
  const sorted = [...tsMs].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap <= capMs) total += gap;
  }
  return total;
}
