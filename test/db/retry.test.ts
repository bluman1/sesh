import { describe, it, expect } from "vitest";
import { ifBusyThen, isSqliteBusy, withBusyRetry } from "../../src/db/retry";

// A no-op sleep so retry tests run instantly without real timers.
const noSleep = async () => {};

function busyError(): Error {
  const err = new Error("database is locked") as Error & { code: string };
  err.code = "SQLITE_BUSY";
  return err;
}

describe("isSqliteBusy", () => {
  it("is true for an error with a SQLITE_BUSY code", () => {
    expect(isSqliteBusy(busyError())).toBe(true);
  });

  it("is true for the 'database is locked' message even without a code", () => {
    expect(isSqliteBusy(new Error("database is locked"))).toBe(true);
  });

  it("is false for unrelated errors", () => {
    expect(isSqliteBusy(new Error("no such table: sessions"))).toBe(false);
    expect(isSqliteBusy(null)).toBe(false);
    expect(isSqliteBusy("database is locked")).toBe(false);
  });
});

describe("withBusyRetry", () => {
  it("retries on SQLITE_BUSY and returns once the lock clears", async () => {
    let attempts = 0;
    const result = await withBusyRetry(
      () => {
        attempts++;
        if (attempts < 3) throw busyError();
        return "ok";
      },
      { sleep: noSleep },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("rethrows a non-busy error immediately without retrying", async () => {
    let attempts = 0;
    await expect(
      withBusyRetry(
        () => {
          attempts++;
          throw new Error("no such table: sessions");
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow("no such table");
    expect(attempts).toBe(1);
  });

  it("gives up after the attempt budget and rethrows the busy error", async () => {
    let attempts = 0;
    await expect(
      withBusyRetry(
        () => {
          attempts++;
          throw busyError();
        },
        { attempts: 4, sleep: noSleep },
      ),
    ).rejects.toThrow("database is locked");
    expect(attempts).toBe(4);
  });

  it("supports async operations", async () => {
    let attempts = 0;
    const result = await withBusyRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw busyError();
        return 42;
      },
      { sleep: noSleep },
    );
    expect(result).toBe(42);
    expect(attempts).toBe(2);
  });
});

describe("ifBusyThen", () => {
  it("returns the value and does not call onBusy when fn succeeds", async () => {
    let onBusyCalls = 0;
    const result = await ifBusyThen(
      async () => "scanned",
      () => {
        onBusyCalls++;
      },
    );
    expect(result).toBe("scanned");
    expect(onBusyCalls).toBe(0);
  });

  it("swallows a busy error, returns undefined, and invokes onBusy", async () => {
    let received: unknown = null;
    const result = await ifBusyThen(
      async () => {
        throw busyError();
      },
      (err) => {
        received = err;
      },
    );
    expect(result).toBeUndefined();
    expect(isSqliteBusy(received)).toBe(true);
  });

  it("rethrows a non-busy error and does not call onBusy", async () => {
    let onBusyCalls = 0;
    await expect(
      ifBusyThen(
        async () => {
          throw new Error("disk I/O error");
        },
        () => {
          onBusyCalls++;
        },
      ),
    ).rejects.toThrow("disk I/O error");
    expect(onBusyCalls).toBe(0);
  });
});
