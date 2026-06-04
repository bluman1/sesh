#!/usr/bin/env bash
# Build per-platform VSIXs. The database engine is now Node's built-in
# node:sqlite (no native binary), so the only per-platform payload left is
# onnxruntime-node's bins (used by the opt-in local embedder). Each VSIX
# strips the other platforms' onnxruntime bins to stay marketplace-sized.
#
# vsce package --target <pair> publishes a platform-tagged VSIX; the
# marketplace serves the right one to each installer.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")

# Platforms = intersection of (vsce targets) and (onnxruntime-node supports).
# onnxruntime-node has no darwin-x64 binary, so Intel Mac is unsupported.
PLATFORMS=(
  "darwin-arm64:darwin:arm64"
  "linux-x64:linux:x64"
  "linux-arm64:linux:arm64"
  "win32-x64:win32:x64"
  "win32-arm64:win32:arm64"
)

# Snapshot the base .vscodeignore so we can append platform exclusions
# per build and then restore.
cp .vscodeignore .vscodeignore.base

trap 'mv .vscodeignore.base .vscodeignore 2>/dev/null || true; rm -f sesh-*.vsix.tmp' EXIT

for entry in "${PLATFORMS[@]}"; do
  IFS=":" read -r vsce_pair os arch <<< "$entry"
  echo ""
  echo "════ Packaging $vsce_pair ════"

  # Start from base ignore.
  cp .vscodeignore.base .vscodeignore

  # Exclude every other onnxruntime-node platform/arch.
  for os_other in darwin linux win32; do
    if [[ "$os_other" == "$os" ]]; then
      # Same OS — exclude other archs only.
      for arch_other in arm64 x64; do
        if [[ -d "node_modules/onnxruntime-node/bin/napi-v6/$os_other/$arch_other" ]] && [[ "$arch_other" != "$arch" ]]; then
          echo "node_modules/onnxruntime-node/bin/napi-v6/$os_other/$arch_other/**" >> .vscodeignore
        fi
      done
    else
      # Different OS — exclude entirely.
      echo "node_modules/onnxruntime-node/bin/napi-v6/$os_other/**" >> .vscodeignore
    fi
  done

  out="sesh-${VERSION}-${vsce_pair}.vsix"
  rm -f "$out"
  npx --yes @vscode/vsce package --target "$vsce_pair" --out "$out"
done

# Restore base ignore (also handled in trap, but make explicit).
mv .vscodeignore.base .vscodeignore

echo ""
echo "════ Done ════"
ls -lh sesh-${VERSION}-*.vsix
