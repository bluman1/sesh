import { useEffect, useState } from "react";
import { onHostMessage, postToHost } from "../messaging";

export function useAllTags(): string[] {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    const dispose = onHostMessage((msg) => {
      if (msg.kind === "allTags") setTags(msg.tags);
    });
    postToHost({ kind: "listAllTags" });
    return dispose;
  }, []);
  return tags;
}
