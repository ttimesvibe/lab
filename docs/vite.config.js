// lab fresh v2 — vite config
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md (S5.1 A14)

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/lab/",  // GitHub Pages: ttimesvibe.github.io/lab/
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    rollupOptions: {
      output: {
        // build.js 의 stale purge + drift guard 가 detect 하는 패턴
        entryFileNames: "assets/index_build-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
});
