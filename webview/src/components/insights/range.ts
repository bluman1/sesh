export type InsightsRange = "today" | "7d" | "30d" | "1y" | "all" | "custom";

export const RANGE_OPTIONS: { id: InsightsRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "1y", label: "1 year" },
  { id: "all", label: "All time" },
];

export const RANGE_TITLE: Record<InsightsRange, string> = {
  today: "Today's standup",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "1y": "Last year",
  all: "All time",
  custom: "Custom range",
};

export function localStartOfDayMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export function localEndOfDayMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}
