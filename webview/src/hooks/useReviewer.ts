import { useEffect, useState } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";

type ReviewerKind = ToWebview & { kind: "reviewerBranch" | "reviewerSessions" | "reviewerPRs" };

export function useReviewerPRs(): { payload: Extract<ReviewerKind, { kind: "reviewerPRs" }> | null } {
  const [payload, setPayload] = useState<Extract<ReviewerKind, { kind: "reviewerPRs" }> | null>(null);
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "reviewerPRs") setPayload(msg);
    });
    postToHost({ kind: "getReviewerPRs" });
    return off;
  }, []);
  return { payload };
}
