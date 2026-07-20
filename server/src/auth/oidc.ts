// OIDC (auth-code + PKCE) using openid-client v6. The BFF drives the login,
// stores the resulting id_token/refresh_token in the server-side session, and
// forwards the id_token to kcp as a bearer on each proxied request.
//
// Dev note: local IdPs (Dex) use a self-signed cert. When KCP_INSECURE is set
// we install a custom fetch that skips issuer TLS verification. Dev only.

import * as client from "openid-client";
import { Agent } from "undici";
import type { OidcConfig } from "../config.js";

let configPromise: Promise<client.Configuration> | null = null;

export function getOidcConfig(
  oidc: OidcConfig,
  insecure: boolean,
): Promise<client.Configuration> {
  if (!configPromise) configPromise = init(oidc, insecure);
  return configPromise;
}

async function init(
  oidc: OidcConfig,
  insecure: boolean,
): Promise<client.Configuration> {
  const server = new URL(oidc.issuerUrl);

  const options: Parameters<typeof client.discovery>[4] = {};
  if (server.protocol === "http:") {
    options.execute = [client.allowInsecureRequests];
  }

  const config = await client.discovery(
    server,
    oidc.clientId,
    // A string here is treated as the client secret; omit for public+PKCE.
    oidc.clientSecret ?? undefined,
    oidc.clientSecret ? undefined : client.None(),
    options,
  );

  if (insecure && server.protocol === "https:") {
    const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    // openid-client honours a per-config custom fetch via this symbol.
    (config as unknown as Record<symbol, unknown>)[client.customFetch] = (
      url: string,
      opts: Record<string, unknown>,
    ) => fetch(url, { ...opts, dispatcher } as RequestInit);
  }

  return config;
}

export interface LoginHandshake {
  url: string;
  verifier: string;
  state: string;
  nonce: string;
}

export async function startLogin(
  config: client.Configuration,
  oidc: OidcConfig,
): Promise<LoginHandshake> {
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: oidc.redirectUrl,
    scope: oidc.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  return { url: url.href, verifier, state, nonce };
}

export interface TokenSet {
  idToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  username: string;
  email?: string;
  groups: string[];
}

export async function completeLogin(
  config: client.Configuration,
  currentUrl: URL,
  checks: { verifier: string; state: string; nonce: string },
): Promise<TokenSet> {
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: checks.verifier,
    expectedState: checks.state,
    expectedNonce: checks.nonce,
  });

  return toTokenSet(tokens);
}

export async function refresh(
  config: client.Configuration,
  refreshToken: string,
): Promise<TokenSet> {
  const tokens = await client.refreshTokenGrant(config, refreshToken);
  return toTokenSet(tokens);
}

function toTokenSet(
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
): TokenSet {
  const claims = tokens.claims();
  const rawGroups = claims?.groups;
  const groups = Array.isArray(rawGroups) ? (rawGroups as string[]) : [];
  const email = claims?.email as string | undefined;
  const sub = claims?.sub as string | undefined;
  const secs = tokens.expiresIn();

  return {
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token,
    expiresAt: secs !== undefined ? Date.now() + secs * 1000 : undefined,
    username: email ?? sub ?? "unknown",
    email,
    groups,
  };
}
