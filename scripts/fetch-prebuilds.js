#!/usr/bin/env node
// Downloads prebuilt better-sqlite3 binaries for several (electron ABI × platform/arch)
// combinations and stores them under `prebuilds/<platform>-<arch>-electron-abi-<ABI>/better_sqlite3.node`
// at the extension root. Idempotent — skips files that already exist.

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { execFileSync } = require("node:child_process");
const os = require("node:os");

const BSQ_VERSION = "12.9.0"; // must match the version in package.json
const ABIS = [
  { abi: 128, electron: "32.0.0" },
  { abi: 130, electron: "33.0.0" },
  { abi: 133, electron: "34.0.0" },
  { abi: 137, electron: "36.0.0" },
  { abi: 138, electron: "38.0.0" },
  { abi: 140, electron: "39.0.0" },
];
const PLATFORMS = [
  ["darwin", "x64"],
  ["darwin", "arm64"],
  ["linux", "x64"],
  ["linux", "arm64"],
  ["win32", "x64"],
];

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "prebuilds");

function urlFor(abi, platform, arch) {
  return `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BSQ_VERSION}/better-sqlite3-v${BSQ_VERSION}-electron-v${abi}-${platform}-${arch}.tar.gz`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => https.get(u, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return get(res.headers.location);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close((err) => err ? reject(err) : resolve()));
    }).on("error", reject);
    get(url);
  });
}

async function fetchOne(abi, electron, platform, arch) {
  const dirName = `${platform}-${arch}-electron-abi-${abi}`;
  const outPath = path.join(OUT_DIR, dirName, "better_sqlite3.node");
  if (fs.existsSync(outPath)) {
    console.log(`✓ ${dirName} (cached)`);
    return;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `bsq-prebuild-`));
  const tarPath = path.join(tmpDir, "binary.tar.gz");
  const url = urlFor(abi, platform, arch);
  try {
    await download(url, tarPath);
    // Extract tarball.
    execFileSync("tar", ["-xzf", tarPath, "-C", tmpDir]);
    const inner = path.join(tmpDir, "build", "Release", "better_sqlite3.node");
    if (!fs.existsSync(inner)) {
      throw new Error(`Expected build/Release/better_sqlite3.node in ${url}, not found`);
    }
    fs.copyFileSync(inner, outPath);
    console.log(`✓ ${dirName} fetched`);
  } catch (e) {
    console.warn(`✗ ${dirName} skipped: ${e.message}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

(async () => {
  console.log(`Fetching better-sqlite3 ${BSQ_VERSION} prebuilds → ${OUT_DIR}`);
  for (const { abi, electron } of ABIS) {
    for (const [platform, arch] of PLATFORMS) {
      await fetchOne(abi, electron, platform, arch);
    }
  }
  // Clean up any empty directories left behind by failed fetches.
  for (const entry of fs.readdirSync(OUT_DIR)) {
    const dir = path.join(OUT_DIR, entry);
    if (fs.statSync(dir).isDirectory()) {
      const files = fs.readdirSync(dir);
      if (files.length === 0) {
        fs.rmdirSync(dir);
      }
    }
  }
  console.log("Done.");
})().catch((e) => { console.error(e); process.exit(1); });
