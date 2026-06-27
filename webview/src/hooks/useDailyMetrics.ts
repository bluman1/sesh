import { useEffect, useState } from "react";
import { onHostMessage, postToHost } from "../messaging";

export interface DailyMetric {
  day: string; cost: number; sessions: number; turns: number;
  activeMs: number; cacheHitRate: number; costPerTurn: number;
}

export function useDailyMetrics(month: string): DailyMetric[] | null {
  const [rows, setRows] = useState<DailyMetric[] | null>(null);
  useEffect(() => {
    setRows(null);
    const off = onHostMessage((msg) => {
      if (msg.kind === "dailyMetrics" && msg.month === month) {
        setRows(msg.payload as DailyMetric[]);
      }
    });
    postToHost({ kind: "getDailyMetrics", month });
    return off;
  }, [month]);
  return rows;
}
