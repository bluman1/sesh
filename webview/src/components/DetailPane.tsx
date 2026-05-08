import { useEffect, useState } from "react";
import {
  postToHost,
  type SessionDetail,
  type TranscriptMessage,
} from "../messaging";
import { Transcript } from "./Transcript";
import { Icon } from "./Icon";
import { SourceBadge } from "./SourceBadge";
import { useCategories } from "../hooks/useCategories";
import { useAllTags } from "../hooks/useAllTags";

interface Props {
  session: SessionDetail | null;
  transcript: TranscriptMessage[];
  loading: boolean;
  currentPath: string | null;
  searchQuery: string;
}

function formatAbsolute(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function formatRelative(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function DetailPane({
  session,
  transcript,
  loading,
  currentPath,
  searchQuery,
}: Props): JSX.Element {
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
    return (
      <div className="sesh-detail-empty">
        <Icon name="list-selection" />
        <p>Select a session to view its details.</p>
      </div>
    );
  }

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    const next =
      trimmed === (session.auto_title ?? "") || trimmed === "" ? null : trimmed;
    postToHost({ kind: "setCustomTitle", id: session.id, title: next });
  };

  const commitNotes = () => {
    const next = notesDraft.length === 0 ? null : notesDraft;
    postToHost({ kind: "setNotes", id: session.id, notes: next });
  };

  const toggleFavorite = () =>
    postToHost({
      kind: "setFavorited",
      id: session.id,
      favorited: !session.favorited,
    });

  const toggleArchive = () =>
    postToHost({
      kind: "setArchived",
      id: session.id,
      archived: !session.archived,
    });

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
    .filter(
      (t) =>
        !session.tags.includes(t) &&
        t.toLowerCase().includes(tagInput.toLowerCase()),
    )
    .slice(0, 5);

  const sameWorkspace = currentPath && session.project_path === currentPath;
  const isOrphan = session.orphaned === 1;

  return (
    <div className="sesh-detail">
      <header className="sesh-detail-header">
        <div className="sesh-detail-title-row">
          <button
            className={`sesh-icon-btn ${session.favorited ? "is-on" : ""}`}
            onClick={toggleFavorite}
            title={session.favorited ? "Unfavorite" : "Favorite"}
          >
            <Icon name={session.favorited ? "star-full" : "star-empty"} />
          </button>
          <input
            className="sesh-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            placeholder={session.auto_title ?? "(untitled)"}
            spellCheck={false}
          />
          <button
            className={`sesh-text-btn ${session.archived ? "is-on" : ""}`}
            onClick={toggleArchive}
            title={
              session.archived
                ? "Restore from archive"
                : "Move to archive"
            }
          >
            <Icon name="archive" />
            <span>{session.archived ? "Archived" : "Archive"}</span>
          </button>
        </div>

        <dl className="sesh-detail-meta-strip">
          <div>
            <dt>Source</dt>
            <dd>
              <SourceBadge source={session.source} showLabel />
            </dd>
          </div>
          <div>
            <dt>Last active</dt>
            <dd title={formatAbsolute(session.last_active_at)}>
              {formatRelative(session.last_active_at)}
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd title={formatAbsolute(session.created_at)}>
              {formatRelative(session.created_at)}
            </dd>
          </div>
          <div>
            <dt>Messages</dt>
            <dd>{session.message_count}</dd>
          </div>
        </dl>
        <div className="sesh-detail-folder">
          <span className="sesh-detail-folder-label">Folder</span>
          <span
            className="sesh-detail-folder-path"
            title={session.project_path}
            dir="rtl"
          >
            {session.project_path}
          </span>
        </div>

        <div className="sesh-detail-actions">
          {isOrphan ? (
            <span className="sesh-detail-hint sesh-detail-hint-warn">
              <Icon name="warning" /> Transcript was pruned by Claude Code —
              can't be resumed.
            </span>
          ) : (
            <>
              <button
                className="sesh-action-btn sesh-action-primary"
                onClick={() =>
                  postToHost({ kind: "resumeInTerminal", sessionId: session.id })
                }
                title="Run claude --resume in a new terminal in this session's cwd"
              >
                <Icon name="terminal" /> Resume in terminal
              </button>
              {sameWorkspace && (
                <button
                  className="sesh-action-btn"
                  onClick={() =>
                    postToHost({
                      kind: "openClaudeCodePanel",
                      sessionId: session.id,
                    })
                  }
                  title="Resume this session in the Claude Code editor panel"
                >
                  <Icon name="play" /> Resume in panel
                </button>
              )}
              {currentPath && !sameWorkspace && (
                <span
                  className="sesh-detail-hint"
                  title={`Open ${session.project_path} as a workspace to enable panel resume.`}
                >
                  <Icon name="info" /> Panel resume needs this project's
                  workspace
                </span>
              )}
            </>
          )}
        </div>
      </header>

      <section className="sesh-detail-section">
        <div className="sesh-section-label">Annotations</div>

        <div className="sesh-form-row">
          <label className="sesh-form-label">Category</label>
          <div className="sesh-form-control">
            <select
              className="sesh-select"
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
              <input
                className="sesh-input sesh-new-category-input"
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
            )}
          </div>
        </div>

        <div className="sesh-form-row sesh-tags-row">
          <label className="sesh-form-label">Tags</label>
          <div className="sesh-form-control sesh-tags-edit">
            {session.tags.map((t) => (
              <span key={t} className="sesh-tag sesh-tag-removable">
                {t}
                <button
                  className="sesh-tag-x"
                  onClick={() => removeTag(t)}
                  title="Remove tag"
                  aria-label={`Remove ${t}`}
                >
                  <Icon name="close" />
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
                } else if (
                  e.key === "Backspace" &&
                  !tagInput &&
                  session.tags.length > 0
                ) {
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

        <div className="sesh-form-row sesh-notes-row">
          <label className="sesh-form-label">Notes</label>
          <textarea
            className="sesh-notes-input"
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={commitNotes}
            placeholder="Add a note. Saves on blur."
            spellCheck={false}
          />
        </div>
      </section>

      <section className="sesh-detail-section sesh-detail-transcript">
        <div className="sesh-section-label">
          Transcript
          {isOrphan && transcript.length > 0 && (
            <span className="sesh-section-hint">
              <Icon name="archive" /> Reading from Sesh archive (original
              pruned)
            </span>
          )}
        </div>
        {isOrphan && transcript.length === 0 ? (
          <div className="sesh-transcript-empty sesh-transcript-pruned">
            <Icon name="archive" />
            <p>
              Transcript pruned by Claude Code, no Sesh archive available — only
              metadata remains.
            </p>
            <p className="sesh-transcript-pruned-hint">
              Enable <code>sesh.archiveTranscripts</code> in settings to keep a
              Sesh-side copy of future sessions.
            </p>
          </div>
        ) : (
          <Transcript messages={transcript} searchQuery={searchQuery} />
        )}
      </section>
    </div>
  );
}
