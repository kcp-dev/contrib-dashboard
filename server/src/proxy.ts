// Reverse proxy that forwards /api/kcp/* to the upstream kcp front-proxy as
// plain Kubernetes REST. The SPA calls same-origin paths like
//   /api/kcp/clusters/root/apis/tenancy.kcp.io/v1alpha1/workspaces
// which map to
//   <baseUrl>/clusters/root/apis/tenancy.kcp.io/v1alpha1/workspaces

import type { RequestHandler } from "express";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import type { Config } from "./config.js";
import type { Upstream } from "./upstream.js";
import { bearerForRequest } from "./auth/session.js";

export const KCP_PREFIX = "/api/kcp";

export function createKcpProxy(cfg: Config, upstream: Upstream): RequestHandler {
  return createProxyMiddleware({
    target: upstream.baseUrl,
    changeOrigin: true,
    agent: upstream.agent,
    // Strip our /api/kcp prefix; the remainder is a valid kcp REST path.
    pathRewrite: { [`^${KCP_PREFIX}`]: "" },
    // Kubernetes long-polling watches need streaming, not buffering.
    selfHandleResponse: false,
    on: {
      proxyReq: (proxyReq, req) => {
        // Never forward the browser session cookie upstream.
        proxyReq.removeHeader("cookie");

        // Static headers from the kubeconfig (no-oidc), then per-user bearer
        // token from the session (oidc). The latter wins if present.
        for (const [k, v] of Object.entries(upstream.headers)) {
          proxyReq.setHeader(k, v);
        }
        if (cfg.authMode === "oidc") {
          const token = bearerForRequest(req);
          if (token) proxyReq.setHeader("authorization", `Bearer ${token}`);
        }

        fixRequestBody(proxyReq, req);
      },
      error: (err, _req, res) => {
        // res may be a ServerResponse (http) here.
        const r = res as import("http").ServerResponse;
        if (!r.headersSent) {
          r.writeHead(502, { "content-type": "application/json" });
        }
        r.end(
          JSON.stringify({
            kind: "Status",
            apiVersion: "v1",
            status: "Failure",
            message: `upstream proxy error: ${err.message}`,
            code: 502,
          }),
        );
      },
    },
  });
}
