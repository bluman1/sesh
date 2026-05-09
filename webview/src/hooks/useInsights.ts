import { useEffect, useState } from "react";
import { onHostMessage, postToHost } from "../messaging";

export type InsightsTabId = "standup" | "cost" | "leaderboard" | "records";

export function useInsights(tab: InsightsTabId, sinceDays = 7): {
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
    postToHost({ kind: "getInsights", tab, sinceDays });
    return off;
  }, [tab, sinceDays]);

  return {
    payload,
    reload: () => postToHost({ kind: "getInsights", tab, sinceDays }),
  };
}
