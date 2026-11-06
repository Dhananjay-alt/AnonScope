import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/web/src/**/*.test.ts"],
    environment: "node",
  },
});
