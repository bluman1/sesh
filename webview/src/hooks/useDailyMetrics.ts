import { useEffect, useState } from "react";
import { onHostMessage, postToHost } from "../messaging";

export interface DailyMetric {
  day: string; cost: number; sessions: number; turns: number;
  activeMs: number; cacheHitRate: number; costPerTurn: number;
}

export interface DayValue { day: string; value: number; }

export interface MonthlySummary {
  totalCost: number; totalSessions: number; totalTurns: number;
  totalActiveMs: number; cacheHitRate: number; costPerTurn: number;
  topCostDay: DayValue | null; topTurnsDay: DayValue | null;
  topActiveDay: DayValue | null; bestCacheDay: DayValue | null;
  worstCacheDay: DayValue | null;
}

export interface MonthlyMetrics { days: DailyMetric[]; summary: MonthlySummary; }

export function useDailyMetrics(month: string): MonthlyMetrics | null {
  const [data, setData] = useState<MonthlyMetrics | null>(null);
  useEffect(() => {
    setData(null);
    const off = onHostMessage((msg) => {
      if (msg.kind === "dailyMetrics" && msg.month === month) {
        setData(msg.payload as MonthlyMetrics);
      }
    });
    postToHost({ kind: "getDailyMetrics", month });
    return off;
  }, [month]);
  return data;
}
