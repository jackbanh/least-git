import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/.claude/**",   // exclude worktrees created by Claude Code agents
      "**/dist/**",
      "**/test/e2e/**",  // Playwright specs — run via npm run test:e2e, not vitest
    ],
  },
});
