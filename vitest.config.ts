import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts", "components/**/*.test.ts"],
    // DB-backed booking tests share one Postgres and collide on unique keys
    // (e.g. jobNumber) when test files run in parallel. Serialize files so bare
    // `npm test` and CI match `make test`. See AGENTS.md / toolchain memory.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
