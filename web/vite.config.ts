import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const BFF = process.env.BFF_URL ?? "http://localhost:8080";
const isDemo = process.env.VITE_DEMO === "true";

// GitHub Pages deploys to /<repo-name>/ — set via VITE_BASE_URL in CI
const base = process.env.VITE_BASE_URL ?? "/";

export default defineConfig({
  base,
  plugins: [vue()],
  define: {
    // Expose to client bundle
    "import.meta.env.VITE_DEMO": JSON.stringify(process.env.VITE_DEMO ?? "false"),
  },
  server: {
    port: 5173,
    ...(isDemo ? {} : {
      proxy: {
        "/api/kcp":     { target: BFF, changeOrigin: true },
        "/api/session": { target: BFF, changeOrigin: true },
        "/auth":        { target: BFF, changeOrigin: true },
      },
    }),
  },
});
