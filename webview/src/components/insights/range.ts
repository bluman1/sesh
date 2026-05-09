export type InsightsRange = "today" | "7d" | "30d" | "1y" | "all";

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
};
