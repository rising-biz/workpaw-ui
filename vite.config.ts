import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      // motion is externalized (including its /react subpath) so consuming
      // apps dedupe their own copy; react/react-dom were already external.
      // Other UI deps (radix, lucide, next-themes) remain bundled — matching
      // the pre-existing pattern.
      external: (id: string) =>
        id === "react" ||
        id === "react-dom" ||
        id === "react/jsx-runtime" ||
        id.startsWith("motion"),
    },
  },
});
