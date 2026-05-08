import { useEffect, useState } from "react";
import {
  postToHost,
  type SessionDetail,
  type TranscriptMessage,
} from "../messaging";
import { Transcript } from "./Transcript";
import { useCategories } from "../hooks/useCategories";
import { useAllTags } from "../hooks/useAllTags";

interface Props {
  session: SessionDetail | null;
  transcript: TranscriptMessage[];
  loading: boolean;
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function DetailPane({ session, transcript, loading }: Props): JSX.Element {
  const { categories, create: createCategory } = useCategories();
  const allTags = useAllTags();
  const [titleDraft, setTitleDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryDraft, setNewCategoryDraft] = useState("");

  useEffect(() => {
    setTitleDraft(session?.custom_title ?? session?.auto_title ?? "");
    setNotesDraft(session?.notes ?? "");
    setTagInput("");
    setCreatingCategory(false);
    setNewCategoryDraft("");
  }, [session?.id]);

  if (loading && !session) {
    return <div className="sesh-detail-empty">Loading…</div>;
  }
  if (!session) {
    return <div className="sesh-detail-empty">Select a session on the left.</div>;
  }

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    const next = trimmed === (session.auto_title ?? "") || trimmed === ""
      ? null
      : trimmed;
    postToHost({ kind: "setCustomTitle", id: session.id, title: next });
  };

  const commitNotes = () => {
    const next = notesDraft.length === 0 ? null : notesDraft;
    postToHost({ kind: "setNotes", id: session.id, notes: next });
  };

  const toggleFavorite = () => {
    postToHost({
      kind: "setFavorited",
      id: session.id,
      favorited: !session.favorited,
    });
  };

  const toggleArchive = () => {
    postToHost({
      kind: "setArchived",
      id: session.id,
      archived: !session.archived,
    });
  };

  const handleCategoryChange = (raw: string) => {
    if (raw === "__create__") {
      setCreatingCategory(true);
      setNewCategoryDraft("");
      return;
    }
    if (raw === "__none__") {
      postToHost({ kind: "setCategory", id: session.id, categoryId: null });
      return;
    }
    const id = Number(raw);
    if (!Number.isNaN(id)) {
      postToHost({ kind: "setCategory", id: session.id, categoryId: id });
    }
  };

  const submitNewCategory = () => {
    const name = newCategoryDraft.trim();
    if (!name) {
      setCreatingCategory(false);
      return;
    }
    createCategory(name, null, session.id);
    setCreatingCategory(false);
    setNewCategoryDraft("");
  };

  const cancelNewCategory = () => {
    setCreatingCategory(false);
    setNewCategoryDraft("");
  };

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (session.tags.includes(t)) return;
    postToHost({ kind: "setTags", id: session.id, tags: [...session.tags, t] });
    setTagInput("");
  };

  const removeTag = (t: string) => {
    postToHost({
      kind: "setTags",
      id: session.id,
      tags: session.tags.filter((x) => x !== t),
    });
  };

  const tagSuggestions = allTags
    .filter((t) => !session.tags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase()))
    .slice(0, 5);

  return (
    <div className="sesh-detail">
      <div className="sesh-detail-head">
        <div className="sesh-detail-title-row">
          <button
            className={`sesh-icon-btn ${session.favorited ? "is-on" : ""}`}
            onClick={toggleFavorite}
            title={session.favorited ? "Unfavorite" : "Favorite"}
          >
            {session.favorited ? "★" : "☆"}
          </button>
          <input
            className="sesh-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            placeholder={session.auto_title ?? "(untitled)"}
          />
          <button
            className={`sesh-icon-btn ${session.archived ? "is-on" : ""}`}
            onClick={toggleArchive}
            title={session.archived ? "Unarchive" : "Archive"}
          >
            {session.archived ? "📥" : "📤"}
          </button>
        </div>
        <div className="sesh-detail-meta">
          <div className="sesh-detail-row">
            <label>Category</label>
            <select
              className="sesh-scope-select"
              value={session.category_id?.toString() ?? "__none__"}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              <option value="__none__">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id.toString()}>
                  {c.name}
                </option>
              ))}
              <option value="__create__">+ Create new…</option>
            </select>
            {creatingCategory && (
              <span className="sesh-new-category">
                <input
                  className="sesh-tag-input"
                  autoFocus
                  value={newCategoryDraft}
                  onChange={(e) => setNewCategoryDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitNewCategory();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelNewCategory();
                    }
                  }}
                  onBlur={submitNewCategory}
                  placeholder="new category name…"
                />
              </span>
            )}
          </div>
          <div className="sesh-detail-row sesh-tags-row">
            <label>Tags</label>
            <div className="sesh-tags-edit">
              {session.tags.map((t) => (
                <span key={t} className="sesh-tag sesh-tag-removable">
                  {t}
                  <button
                    className="sesh-tag-x"
                    onClick={() => removeTag(t)}
                    title="Remove tag"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="sesh-tag-input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagInput);
                  } else if (e.key === "Backspace" && !tagInput && session.tags.length > 0) {
                    removeTag(session.tags[session.tags.length - 1]);
                  }
                }}
                placeholder={session.tags.length === 0 ? "add a tag…" : ""}
              />
              {tagInput && tagSuggestions.length > 0 && (
                <div className="sesh-tag-suggestions">
                  {tagSuggestions.map((t) => (
                    <button
                      key={t}
                      className="sesh-tag-suggestion"
                      onClick={() => addTag(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="sesh-detail-stats">
            <span>{session.message_count} messages</span>
            <span>·</span>
            <span>created {formatDate(session.created_at)}</span>
            <span>·</span>
            <span>last active {formatDate(session.last_active_at)}</span>
          </div>
          <div className="sesh-detail-path" title={session.file_path}>
            {session.project_path}
          </div>
        </div>
        <div className="sesh-detail-actions">
          <button
            className="sesh-action-btn sesh-action-primary"
            onClick={() =>
              postToHost({ kind: "resumeInTerminal", sessionId: session.id })
            }
            title="Run claude --resume in a new terminal in this session's cwd"
          >
            ▶ Resume in terminal
          </button>
          <button
            className="sesh-action-btn"
            onClick={() =>
              postToHost({ kind: "openClaudeCodePanel", sessionId: session.id })
            }
            title="Resume this session in the Claude Code editor panel"
          >
            ▶ Resume in Claude Code panel
          </button>
        </div>
      </div>
      <div className="sesh-detail-notes">
        <div className="sesh-detail-notes-label">Notes</div>
        <textarea
          className="sesh-notes-input"
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={commitNotes}
          placeholder="Add a note (markdown ok). Saves on blur."
        />
      </div>
      <div className="sesh-detail-transcript">
        <div className="sesh-detail-transcript-label">Transcript</div>
        <Transcript messages={transcript} />
      </div>
    </div>
  );
}
