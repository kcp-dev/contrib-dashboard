import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// In dev, proxy BFF routes to the Node server on :8080 so the SPA runs
// same-origin against /api, /auth and /api/kcp.
const BFF = process.env.BFF_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: BFF, changeOrigin: true },
      "/auth": { target: BFF, changeOrigin: true },
    },
  },
});
