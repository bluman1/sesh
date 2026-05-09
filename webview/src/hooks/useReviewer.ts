import { useEffect, useState } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";

type ReviewerKind = ToWebview & { kind: "reviewerBranch" | "reviewerSessions" | "reviewerPRs" };

export function useReviewerBranch(): { payload: Extract<ReviewerKind, { kind: "reviewerBranch" }> | null } {
  const [payload, setPayload] = useState<Extract<ReviewerKind, { kind: "reviewerBranch" }> | null>(null);
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "reviewerBranch") setPayload(msg);
    });
    postToHost({ kind: "getReviewerBranch" });
    return off;
  }, []);
  return { payload };
}

export function useReviewerSessions(): { payload: Extract<ReviewerKind, { kind: "reviewerSessions" }> | null } {
  const [payload, setPayload] = useState<Extract<ReviewerKind, { kind: "reviewerSessions" }> | null>(null);
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "reviewerSessions") setPayload(msg);
    });
    postToHost({ kind: "getReviewerSessions" });
    return off;
  }, []);
  return { payload };
}

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
