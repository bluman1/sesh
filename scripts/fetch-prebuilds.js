#!/usr/bin/env node
// Downloads prebuilt better-sqlite3 binaries for several (electron ABI × platform/arch)
// combinations and stores them under `prebuilds/<platform>-<arch>-electron-abi-<ABI>/better_sqlite3.node`
// at the extension root. Idempotent — skips files that already exist.
//
// We try multiple better-sqlite3 versions in order until we find a published
// prebuild for each ABI. Newer versions are preferred for newer ABIs (where
// the older version may not have built for them); older versions are needed
// for ABIs the latest release skipped (e.g. v12.9.1 doesn't ship ABI 140 but
// v12.9.0 does).
//
// Some ABIs (notably 134, 137, 138 across all currently-published versions)
// have NO upstream prebuilds available. Users on those VSCode versions will
// need to manually rebuild or wait for an upstream release. Run this script
// periodically to pick up newly-published prebuilds.

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { execFileSync } = require("node:child_process");
const os = require("node:os");

// Tried in order: first version with a matching prebuild wins.
const BSQ_VERSIONS = ["12.9.1", "12.9.0", "12.8.0", "12.6.2", "12.5.0"];

// Electron ABIs we want covered. The `electron` field is informational
// (target Electron version that introduced this ABI) — only the abi number
// is used in the URL.
const ABIS = [
  { abi: 119, electron: "28" },
  { abi: 121, electron: "29" },
  { abi: 123, electron: "30" },
  { abi: 125, electron: "31" },
  { abi: 128, electron: "32" },
  { abi: 130, electron: "33" },
  { abi: 132, electron: "33.x" },
  { abi: 133, electron: "34" },
  { abi: 135, electron: "35" },
  { abi: 136, electron: "36" },
  { abi: 137, electron: "36.x" },
  { abi: 138, electron: "37/38" },
  { abi: 139, electron: "38.x" },
  { abi: 140, electron: "39" },
];
const PLATFORMS = [
  ["darwin", "x64"],
  ["darwin", "arm64"],
  ["linux", "x64"],
  ["linux", "arm64"],
  ["win32", "x64"],
  // win32-arm64 prebuilds aren't published by every better-sqlite3 release
  // (e.g. v12.9.1 skips them) but v12.9.0 has them — the version fallback
  // below picks them up. package-platforms.sh ships a win32-arm64 VSIX, so it
  // needs these or the extension can't open its DB on native Windows ARM.
  ["win32", "arm64"],
];

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "prebuilds");

function urlFor(version, abi, platform, arch) {
  return `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/better-sqlite3-v${version}-electron-v${abi}-${platform}-${arch}.tar.gz`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => https.get(u, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return get(res.headers.location);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close((err) => err ? reject(err) : resolve()));
    }).on("error", reject);
    get(url);
  });
}

async function fetchOne(abi, platform, arch) {
  const dirName = `${platform}-${arch}-electron-abi-${abi}`;
  const outPath = path.join(OUT_DIR, dirName, "better_sqlite3.node");
  if (fs.existsSync(outPath)) {
    console.log(`✓ ${dirName} (cached)`);
    return true;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  for (const version of BSQ_VERSIONS) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `bsq-prebuild-`));
    const tarPath = path.join(tmpDir, "binary.tar.gz");
    const url = urlFor(version, abi, platform, arch);
    try {
      await download(url, tarPath);
      execFileSync("tar", ["-xzf", tarPath, "-C", tmpDir]);
      const inner = path.join(tmpDir, "build", "Release", "better_sqlite3.node");
      if (!fs.existsSync(inner)) {
        throw new Error(`tarball missing build/Release/better_sqlite3.node`);
      }
      fs.copyFileSync(inner, outPath);
      console.log(`✓ ${dirName} fetched (better-sqlite3 v${version})`);
      return true;
    } catch (e) {
      // 404 or extraction failure — try the next version.
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
  console.warn(`✗ ${dirName} no upstream prebuild across [${BSQ_VERSIONS.join(", ")}]`);
  return false;
}

(async () => {
  console.log(`Fetching better-sqlite3 prebuilds → ${OUT_DIR}`);
  console.log(`Versions tried: ${BSQ_VERSIONS.join(" → ")}`);
  let ok = 0, miss = 0;
  for (const { abi } of ABIS) {
    for (const [platform, arch] of PLATFORMS) {
      const got = await fetchOne(abi, platform, arch);
      if (got) ok++; else miss++;
    }
  }
  // Clean up empty leftover directories.
  if (fs.existsSync(OUT_DIR)) {
    for (const entry of fs.readdirSync(OUT_DIR)) {
      const dir = path.join(OUT_DIR, entry);
      if (fs.statSync(dir).isDirectory()) {
        const files = fs.readdirSync(dir);
        if (files.length === 0) fs.rmdirSync(dir);
      }
    }
  }
  console.log(`\nDone — ${ok} fetched, ${miss} missing.`);
  if (miss > 0) console.log("Missing ABIs are unavailable upstream; users on those VSCode versions will need to manually rebuild.");
})().catch((e) => { console.error(e); process.exit(1); });
