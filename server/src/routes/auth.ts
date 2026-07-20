// OIDC auth routes: /auth/login, /auth/callback, /auth/logout. Only mounted in
// oidc mode; in no-oidc mode these 404.

import { Router } from "express";
import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import {
  getOidcConfig,
  startLogin,
  completeLogin,
  refresh,
} from "../auth/oidc.js";

export function authRouter(cfg: Config): Router {
  const r = Router();

  if (cfg.authMode !== "oidc" || !cfg.oidc) {
    const off: RequestHandler = (_req, res) => {
      res.status(404).json({ error: "oidc disabled (auth mode is 'none')" });
    };
    r.get("/login", off);
    r.get("/callback", off);
    r.post("/logout", off);
    return r;
  }

  const oidc = cfg.oidc;

  r.get("/login", async (req, res) => {
    try {
      const config = await getOidcConfig(oidc, cfg.kcpInsecure);
      const hs = await startLogin(config, oidc);
      req.session.codeVerifier = hs.verifier;
      req.session.oidcState = hs.state;
      req.session.nonce = hs.nonce;
      res.redirect(hs.url);
    } catch (e) {
      res.status(500).json({ error: `login init failed: ${String(e)}` });
    }
  });

  r.get("/callback", async (req, res) => {
    try {
      const { codeVerifier, oidcState, nonce } = req.session;
      if (!codeVerifier || !oidcState || !nonce) {
        res.status(400).json({ error: "missing login state; retry /auth/login" });
        return;
      }
      const config = await getOidcConfig(oidc, cfg.kcpInsecure);

      // Reconstruct the full callback URL (registered redirect + incoming query).
      const cb = new URL(oidc.redirectUrl);
      cb.search = new URL(req.originalUrl, cb.origin).search;

      const t = await completeLogin(config, cb, {
        verifier: codeVerifier,
        state: oidcState,
        nonce,
      });

      req.session.idToken = t.idToken;
      req.session.refreshToken = t.refreshToken;
      req.session.expiresAt = t.expiresAt;
      req.session.user = {
        username: t.username,
        email: t.email,
        groups: t.groups,
      };
      delete req.session.codeVerifier;
      delete req.session.oidcState;
      delete req.session.nonce;

      res.redirect("/");
    } catch (e) {
      res.status(500).json({ error: `callback failed: ${String(e)}` });
    }
  });

  r.post("/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  return r;
}

// Middleware (oidc mode) that pre-emptively refreshes an about-to-expire
// id_token before the request is proxied upstream.
export function tokenRefresh(cfg: Config): RequestHandler {
  return async (req, _res, next) => {
    const s = req.session;
    if (
      cfg.oidc &&
      s?.refreshToken &&
      s.expiresAt &&
      Date.now() > s.expiresAt - 30_000
    ) {
      try {
        const config = await getOidcConfig(cfg.oidc, cfg.kcpInsecure);
        const t = await refresh(config, s.refreshToken);
        if (t.idToken) s.idToken = t.idToken;
        if (t.refreshToken) s.refreshToken = t.refreshToken;
        s.expiresAt = t.expiresAt;
      } catch {
        // Let the upstream return 401; the SPA will re-initiate login.
      }
    }
    next();
  };
}
