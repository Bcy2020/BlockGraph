import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    exclude: ["test-workspace/**", "test-workspace-complex/**", "node_modules/**"],
  },
});
