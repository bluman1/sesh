import { useEffect, useState } from "react";
import { onHostMessage, postToHost } from "../messaging";
import type { InsightsRange } from "../components/insights/range";

export type InsightsTabId = "standup" | "cost" | "leaderboard" | "records";

export function useInsights(
  tab: InsightsTabId,
  range: InsightsRange,
  custom?: { start: number; end: number } | null,
): { payload: unknown; reload: () => void } {
  const [payload, setPayload] = useState<unknown>(null);
  const send = () => {
    if (range === "custom" && custom) {
      postToHost({ kind: "getInsights", tab, range: "custom", start: custom.start, end: custom.end });
    } else if (range !== "custom") {
      postToHost({ kind: "getInsights", tab, range });
    }
  };
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "insights" && msg.tab === tab) setPayload(msg.payload);
    });
    send();
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, range, custom?.start, custom?.end]);
  return { payload, reload: send };
}
