// Session helpers. In no-oidc mode there is no user session; the BFF acts with
// the kubeconfig identity. In oidc mode (later milestone) the session holds the
// user's tokens and identity.

import type { Request } from "express";

export interface SessionUser {
  username: string;
  groups: string[];
  email?: string;
}

// Shape stored on express-session's `req.session`.
declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    idToken?: string;
    refreshToken?: string;
    // Epoch ms when the current id_token expires (for pre-emptive refresh).
    expiresAt?: number;
    // PKCE / OIDC login handshake state.
    codeVerifier?: string;
    oidcState?: string;
    nonce?: string;
  }
}

// Returns the bearer token to forward upstream for this request, if any.
export function bearerForRequest(req: {
  session?: { idToken?: string };
}): string | undefined {
  return req.session?.idToken;
}

export function currentUser(req: Request): SessionUser | null {
  return req.session?.user ?? null;
}
