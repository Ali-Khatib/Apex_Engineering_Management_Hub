import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true },
  build: {
    rollupOptions: {
      output: {
        // The library is a 536KB JSON blob and React/marked rarely change.
        // Splitting them keeps the app chunk small enough to re-download
        // cheaply on every deploy.
        manualChunks(id) {
          if (id.includes("src/data/library.json")) return "library";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("node_modules/marked") || id.includes("node_modules/dompurify")) return "markdown";
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
