import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig keeps jsx as "preserve" for Next; the screen render test needs JSX compiled
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
