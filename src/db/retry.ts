/**
 * SQLite write contention helpers.
 *
 * Sesh runs one extension instance per VSCode window, and every window opens
 * its own connection to the SAME `~/.sesh/db.sqlite`. WAL mode lets readers
 * run concurrently but allows only a single writer at a time, so
 * when several windows do activation-time indexing at once a write can come
 * back as SQLITE_BUSY ("database is locked"). These helpers let callers wait
 * out transient contention instead of treating it as fatal.
 */

/** True for the SQLITE_BUSY / "database is locked" family of errors. */
export function isSqliteBusy(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // better-sqlite3 surfaces the result code directly as `code`.
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && code.startsWith("SQLITE_BUSY")) return true;
  // node:sqlite reports every SQLite error as code "ERR_SQLITE_ERROR" and
  // carries the numeric result code in `errcode`. The low byte is the primary
  // result code; SQLITE_BUSY is 5 (covers extended 261/517/773 too).
  const errcode = (err as { errcode?: unknown }).errcode;
  if (typeof errcode === "number" && (errcode & 0xff) === 5) return true;
  const msg = (err as { message?: unknown }).message;
  return (
    typeof msg === "string" &&
    /database (is|table is|schema is) locked/i.test(msg)
  );
}

export interface BusyRetryOptions {
  /** Total attempts, including the first. Default 5. */
  attempts?: number;
  /** Base backoff in ms; doubles each retry up to maxDelayMs. Default 50. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 1000. */
  maxDelayMs?: number;
  /** Injectable sleep so tests don't wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying with exponential backoff while it throws SQLITE_BUSY.
 * Non-busy errors propagate immediately. After the attempt budget is spent
 * the last busy error is rethrown. The backoff is `await`ed, so the event
 * loop yields between attempts — letting the window that holds the write
 * lock finish and commit.
 */
export async function withBusyRetry<T>(
  fn: () => T | Promise<T>,
  opts: BusyRetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const base = opts.baseDelayMs ?? 50;
  const max = opts.maxDelayMs ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isSqliteBusy(err) || i === attempts - 1) throw err;
      await sleep(Math.min(max, base * 2 ** i));
    }
  }
  throw lastErr;
}

/**
 * Run `fn`; if it fails with SQLITE_BUSY, treat that as non-fatal — call
 * `onBusy(err)` (e.g. to log and schedule a background retry) and resolve to
 * `undefined` instead of throwing. Any other error propagates. This is the
 * activation safety net: a transient cross-window lock must never abort
 * startup, because reads keep working (WAL) so the panel can still open.
 */
export async function ifBusyThen<T>(
  fn: () => Promise<T>,
  onBusy: (err: unknown) => void,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (isSqliteBusy(err)) {
      onBusy(err);
      return undefined;
    }
    throw err;
  }
}
