import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the UI talks to the FastAPI backend through this proxy, so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
