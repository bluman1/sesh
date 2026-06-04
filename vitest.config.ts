import { defineConfig } from "vitest/config";

// node:sqlite (used by src/db/connection.ts) needs the --experimental-sqlite
// flag on Node 22.5–23.3; it's flagless from 23.4 on (and in Node 24, which
// Electron 42 / VSCode ships). Pass the flag only where it's required so
// `npm test` works on both the local Node 22 and a Node 24 dev box.
const [major, minor] = process.versions.node.split(".").map(Number);
const needsSqliteFlag = major === 22 || (major === 23 && minor < 4);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: needsSqliteFlag ? ["--experimental-sqlite"] : [],
      },
    },
  },
});
