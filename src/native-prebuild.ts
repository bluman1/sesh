import * as fs from "node:fs";
import * as path from "node:path";

/**
 * If the bundled better-sqlite3 binary doesn't match the current Electron
 * runtime's ABI, swap in a matching prebuild from the extension's
 * `prebuilds/` directory. Must run before better-sqlite3 is required.
 *
 * Layout:
 *   prebuilds/
 *     <platform>-<arch>-electron-abi-<NODE_MODULE_VERSION>/
 *       better_sqlite3.node
 *
 * If the binary at node_modules/better-sqlite3/build/Release/better_sqlite3.node
 * is already the right one, this is a no-op.
 */
export function ensureNativePrebuild(extensionPath: string): void {
  const abi = process.versions.modules; // e.g. "140"
  const platform = process.platform;    // "darwin" / "linux" / "win32"
  const arch = process.arch;            // "x64" / "arm64"
  const dirName = `${platform}-${arch}-electron-abi-${abi}`;

  const prebuilt = path.join(extensionPath, "prebuilds", dirName, "better_sqlite3.node");
  if (!fs.existsSync(prebuilt)) {
    // No matching prebuild bundled. Hope the host already has the right one in node_modules.
    return;
  }

  const target = path.join(
    extensionPath,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  );

  // Quick byte-equal check to avoid copying every activation.
  if (fs.existsSync(target)) {
    try {
      const a = fs.statSync(target);
      const b = fs.statSync(prebuilt);
      if (a.size === b.size) {
        // Compare hashes for safety. Cheap once cached.
        const ah = bufHash(fs.readFileSync(target));
        const bh = bufHash(fs.readFileSync(prebuilt));
        if (ah === bh) return;
      }
    } catch { /* fall through */ }
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(prebuilt, target);
  } catch (err) {
    console.warn(`[sesh] failed to swap better-sqlite3 prebuild: ${(err as Error).message}`);
  }
}

function bufHash(buf: Buffer): string {
  // Light hash — first/last 1KB and total size. Don't need crypto guarantees;
  // we only want to detect "is this our prebuild already?".
  const head = buf.slice(0, 1024).toString("hex");
  const tail = buf.slice(Math.max(0, buf.length - 1024)).toString("hex");
  return `${buf.length}:${head}:${tail}`;
}
