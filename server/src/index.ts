// kcp dashboard BFF: serves the SPA, terminates OIDC (later), and reverse-proxies
// Kubernetes REST to the kcp front-proxy.

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { loadConfig } from "./config.js";
import { resolveUpstream } from "./upstream.js";
import { createKcpProxy, KCP_PREFIX } from "./proxy.js";
import { sessionRouter } from "./routes/session.js";
import { authRouter, tokenRefresh } from "./routes/auth.js";

const cfg = loadConfig();
const upstream = resolveUpstream(cfg);

const app = express();
app.disable("x-powered-by");

app.use(cookieParser());
app.use(
  session({
    secret: cfg.sessionSecret,
    name: "kcp_dashboard_sid",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: false },
  }),
);

// Health check.
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// App API (session state, auth).
app.use("/api", sessionRouter(cfg));
app.use("/auth", authRouter(cfg));

// Kubernetes REST passthrough. Mounted before body parsers so request bodies
// stream through untouched. In oidc mode, refresh the token first.
if (cfg.authMode === "oidc") {
  app.use(KCP_PREFIX, tokenRefresh(cfg));
}
app.use(KCP_PREFIX, createKcpProxy(cfg, upstream));

// Serve the built SPA in production; in dev the Vite server handles the UI and
// proxies /api + /auth + /api/kcp back here.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

app.listen(cfg.port, () => {
  console.log(
    `[kcp-dashboard] listening on :${cfg.port} (auth=${cfg.authMode}) → upstream ${upstream.baseUrl}`,
  );
});
