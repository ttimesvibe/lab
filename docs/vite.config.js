import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/lab/",  // ★ GitHub Pages 경로: ttimesvibe.github.io/lab/ (prod /editor/ 와 분리)
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        entryFileNames: "assets/index_build-[hash].js",
      },
    },
  },
});
