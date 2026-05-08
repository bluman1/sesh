import { useEffect, useState } from "react";
import {
  onHostMessage,
  postToHost,
  type Scope,
  type SessionListItem,
  type SearchFilters,
} from "../messaging";

export function useSessions(): {
  sessions: SessionListItem[];
  filters: SearchFilters;
  setFilters: (f: SearchFilters) => void;
  setQuery: (q: string) => void;
  setScope: (s: Scope) => void;
  toggleArchived: () => void;
  toggleFavorited: () => void;
  toggleCategory: (id: number) => void;
  toggleTag: (t: string) => void;
  currentPath: string | null;
  error: string | null;
  indexProgress: { indexed: number; total: number };
} {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [indexProgress, setIndexProgress] = useState({ indexed: 0, total: 0 });
  const [filters, setFiltersState] = useState<SearchFilters>({
    scope: "current",
    currentPath: null,
    query: "",
    category_ids: [],
    tags: [],
    favorited: null,
    archived: false,
  });

  useEffect(() => {
    const dispose = onHostMessage((msg) => {
      if (msg.kind === "sessionList") {
        setSessions(msg.sessions);
        setError(null);
      } else if (msg.kind === "workspace") {
        setCurrentPath(msg.currentPath);
        setFiltersState((f) => ({ ...f, currentPath: msg.currentPath }));
      } else if (msg.kind === "indexProgress") {
        setIndexProgress({ indexed: msg.indexed, total: msg.total });
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    postToHost({ kind: "ready" });
    return dispose;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      postToHost({ kind: "searchSessions", filters });
    }, 150);
    return () => clearTimeout(t);
  }, [filters]);

  const setFilters = (f: SearchFilters) => setFiltersState(f);
  const setQuery = (q: string) => setFiltersState((f) => ({ ...f, query: q }));
  const setScope = (s: Scope) => setFiltersState((f) => ({ ...f, scope: s }));
  const toggleArchived = () =>
    setFiltersState((f) => ({
      ...f,
      archived: f.archived === false ? null : false,
    }));
  const toggleFavorited = () =>
    setFiltersState((f) => ({
      ...f,
      favorited: f.favorited === true ? null : true,
    }));
  const toggleCategory = (id: number) =>
    setFiltersState((f) => ({
      ...f,
      category_ids: f.category_ids.includes(id)
        ? f.category_ids.filter((x) => x !== id)
        : [...f.category_ids, id],
    }));
  const toggleTag = (t: string) =>
    setFiltersState((f) => ({
      ...f,
      tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t],
    }));

  return {
    sessions,
    filters,
    setFilters,
    setQuery,
    setScope,
    toggleArchived,
    toggleFavorited,
    toggleCategory,
    toggleTag,
    currentPath,
    error,
    indexProgress,
  };
}
