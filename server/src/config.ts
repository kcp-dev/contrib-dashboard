// Central configuration for the kcp dashboard BFF, sourced from environment.
//
// Two auth modes:
//   - "none": use a static kubeconfig for all upstream calls (dev/demo only).
//   - "oidc": authenticate the user via an IdP; forward their token upstream.
//             (wired in a later milestone; the plumbing lives here already.)

export type AuthMode = "none" | "oidc";

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  redirectUrl: string;
  scopes: string[];
}

export interface Config {
  port: number;
  authMode: AuthMode;
  sessionSecret: string;

  // Upstream kcp front-proxy base URL (without any /clusters/<path> suffix).
  // May be empty when derived from a kubeconfig instead.
  kcpBaseUrl?: string;
  // Skip upstream TLS verification (dev only).
  kcpInsecure: boolean;
  // Path to a CA bundle to trust for the upstream (optional).
  kcpCaFile?: string;

  // no-oidc mode: path to a kubeconfig used for all upstream calls.
  kubeconfigPath?: string;

  oidc?: OidcConfig;
}

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined) return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function loadConfig(): Config {
  const authMode = (process.env.AUTH_MODE ?? "none") as AuthMode;

  const cfg: Config = {
    port: Number(process.env.PORT ?? 8080),
    authMode,
    sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-session-secret",
    kcpBaseUrl: process.env.KCP_BASE_URL,
    kcpInsecure: bool(process.env.KCP_INSECURE, false),
    kcpCaFile: process.env.KCP_CA_FILE,
    kubeconfigPath: process.env.KUBECONFIG,
  };

  if (authMode === "oidc") {
    cfg.oidc = {
      issuerUrl: required("OIDC_ISSUER_URL"),
      clientId: required("OIDC_CLIENT_ID"),
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      redirectUrl:
        process.env.OIDC_REDIRECT_URL ??
        `http://localhost:${cfg.port}/auth/callback`,
      scopes: (process.env.OIDC_SCOPES ?? "openid email groups offline_access")
        .split(/[,\s]+/)
        .filter(Boolean),
    };
  }

  return cfg;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}
