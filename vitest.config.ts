import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts", "components/**/*.test.ts"],
    // DB-backed booking tests share ONE Postgres and the same seed rows, so in
    // parallel they fight over singleton state: the day's OnCallShift row (one
    // per date), the vehicle_occupancy_no_overlap exclusion constraint, and the
    // drivers' rotation stamps. Serialize files so bare `npm test` and CI match
    // `make test`. See AGENTS.md / toolchain memory.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
