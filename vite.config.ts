import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = undefined; // قابل للتخصيص عبر متغير بيئة عند الحاجة

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: host || true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    cssMinify: "esbuild",
    // عمليات ملفات متوازية محدودة لتفادي نفاد الذاكرة أثناء البناء.
    rollupOptions: { maxParallelFileOps: 2 },
  },
});
