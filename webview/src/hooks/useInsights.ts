import { useEffect, useState } from "react";
import { onHostMessage, postToHost } from "../messaging";
import type { InsightsRange } from "../components/insights/range";

export type InsightsTabId = "standup" | "cost" | "leaderboard" | "records";

export function useInsights(tab: InsightsTabId, range: InsightsRange): {
  payload: unknown;
  reload: () => void;
} {
  const [payload, setPayload] = useState<unknown>(null);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "insights" && msg.tab === tab) {
        setPayload(msg.payload);
      }
    });
    postToHost({ kind: "getInsights", tab, range });
    return off;
  }, [tab, range]);

  return {
    payload,
    reload: () => postToHost({ kind: "getInsights", tab, range }),
  };
}
