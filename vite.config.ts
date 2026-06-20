import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/proxy-api": {
        target: "https://cyclewhere-api-production.cyclewhere.workers.dev",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-api/, "")
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: []
  }
});
