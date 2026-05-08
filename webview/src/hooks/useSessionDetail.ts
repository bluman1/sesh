import { useEffect, useState } from "react";
import {
  onHostMessage,
  postToHost,
  type SessionDetail,
  type TranscriptMessage,
} from "../messaging";

const TRANSCRIPT_LIMIT = 200;

export function useSessionDetail(id: string | null): {
  session: SessionDetail | null;
  transcript: TranscriptMessage[];
  loading: boolean;
} {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return onHostMessage((msg) => {
      if (msg.kind === "sessionDetail" && msg.session.id === id) {
        setSession(msg.session);
        setLoading(false);
      } else if (msg.kind === "transcript" && msg.id === id) {
        setTranscript(msg.messages);
      }
    });
  }, [id]);

  useEffect(() => {
    if (!id) {
      setSession(null);
      setTranscript([]);
      return;
    }
    setLoading(true);
    setSession(null);
    setTranscript([]);
    postToHost({ kind: "getSession", id });
    postToHost({ kind: "getTranscript", id, limit: TRANSCRIPT_LIMIT });
  }, [id]);

  return { session, transcript, loading };
}
