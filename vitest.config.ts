import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
