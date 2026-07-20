// Resolves the upstream kcp connection: base URL, TLS agent, and any static
// auth headers. In no-oidc mode this is derived from a kubeconfig; in oidc mode
// only the CA/TLS is fixed and the bearer token is attached per-request from
// the user's session.

import https from "node:https";
import fs from "node:fs";
import { KubeConfig } from "@kubernetes/client-node";
import type { Config } from "./config.js";

export interface Upstream {
  // Base URL with any trailing /clusters/<path> stripped, e.g.
  // https://127.0.0.1:6443
  baseUrl: string;
  agent: https.Agent;
  // Static headers applied to every upstream request (e.g. a token from the
  // kubeconfig). Empty in oidc mode.
  headers: Record<string, string>;
}

// kcp addresses workspaces via a /clusters/<path> URL prefix. A kubeconfig
// context often already points at a specific workspace; strip that so the proxy
// can address any workspace.
export function stripClustersSuffix(server: string): string {
  const u = new URL(server);
  const idx = u.pathname.indexOf("/clusters/");
  u.pathname = idx >= 0 ? u.pathname.slice(0, idx) : u.pathname.replace(/\/+$/, "");
  if (u.pathname === "/") u.pathname = "";
  return u.toString().replace(/\/+$/, "");
}

export function resolveUpstream(cfg: Config): Upstream {
  if (cfg.authMode === "none") {
    return fromKubeconfig(cfg);
  }
  return fromExplicit(cfg);
}

function fromKubeconfig(cfg: Config): Upstream {
  const kc = new KubeConfig();
  if (cfg.kubeconfigPath) {
    kc.loadFromFile(cfg.kubeconfigPath);
  } else {
    kc.loadFromDefault();
  }

  const cluster = kc.getCurrentCluster();
  if (!cluster) throw new Error("kubeconfig has no current cluster");
  const user = kc.getCurrentUser();

  // Let the client library assemble ca/cert/key/rejectUnauthorized for us; this
  // handles client-cert and CA-file/CA-data cases uniformly.
  const opts: https.AgentOptions = {};
  kc.applyToHTTPSOptions(opts as https.RequestOptions);
  opts.keepAlive = true;

  const headers: Record<string, string> = {};
  if (user?.token) headers["authorization"] = `Bearer ${user.token}`;

  if (cfg.kcpInsecure) opts.rejectUnauthorized = false;

  return {
    baseUrl: cfg.kcpBaseUrl ?? stripClustersSuffix(cluster.server),
    agent: new https.Agent(opts),
    headers,
  };
}

function fromExplicit(cfg: Config): Upstream {
  if (!cfg.kcpBaseUrl) {
    throw new Error("KCP_BASE_URL is required in oidc mode");
  }
  const opts: https.AgentOptions = { keepAlive: true };
  if (cfg.kcpCaFile) opts.ca = fs.readFileSync(cfg.kcpCaFile);
  if (cfg.kcpInsecure) opts.rejectUnauthorized = false;

  return {
    baseUrl: stripClustersSuffix(cfg.kcpBaseUrl),
    agent: new https.Agent(opts),
    headers: {},
  };
}
