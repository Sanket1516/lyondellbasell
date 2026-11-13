import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built into ../public/landing so Next.js serves it at "/" (see next.config.mjs). Every asset, font included, is bundled:
// nothing is fetched from a CDN, so the page works on a disconnected laptop.
export default defineConfig({
  base: "/landing/",
  plugins: [react()],
  build: {
    outDir: "../public/landing",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0,
  },
  server: { port: 5173, proxy: { "/demo": "http://localhost:3000" } },
});
