// /api/session — tells the SPA the auth mode and current identity so it can
// render login state and gate features.

import { Router } from "express";
import type { Config } from "../config.js";
import { currentUser } from "../auth/session.js";

export function sessionRouter(cfg: Config): Router {
  const r = Router();

  r.get("/session", (req, res) => {
    if (cfg.authMode === "none") {
      res.json({
        authMode: "none",
        authenticated: true,
        user: { username: "admin", groups: ["system:masters"] },
        note: "no-oidc mode: acting with the configured kubeconfig identity",
      });
      return;
    }

    const user = currentUser(req);
    res.json({
      authMode: "oidc",
      authenticated: !!user,
      user: user ?? null,
    });
  });

  return r;
}
