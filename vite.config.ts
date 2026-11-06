import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Vite here serves ONLY the local dev harness (index.html + src/main.tsx, see
// `pnpm dev`). The library itself is consumed as SOURCE by the apps
// (package.json `main`/`exports` point at src/index.ts), so there is no lib
// build step — `pnpm build` is just `tsc -b` for type checking. The previous
// lib/rollupOptions config produced a dist/ bundle nothing imported; it was
// removed together with the stale dist/ output.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
