# kcp Dashboard — Design & Implementation Plan

A TypeScript web UI for kcp: workspace navigation/management and APIExport /
APIBinding management, with OIDC or no-OIDC auth.

Status: **planning**. This document is the source of truth for the initial build.

---

## 1. Goals & scope

**MVP goals**

- Browse the workspace tree (root and nested workspaces), see phase/type/URL.
- Create / delete workspaces; switch the "current workspace" context.
- List/inspect APIExports, APIResourceSchemas, APIExportEndpointSlices in a workspace.
- List/inspect APIBindings; create a binding to an export; accept/reject permission claims.
- Auth in two modes, chosen at deploy time:
  - **OIDC** — user logs in via an IdP (Dex in local dev), dashboard acts on the
    user's identity.
  - **No-OIDC** — dashboard uses a static admin kubeconfig (dev/demo only).

**Non-goals (initial)**

- Full generic CRD editor for arbitrary resources (later; the resource-view
  plumbing is designed to allow it).
- RBAC management UI, multi-shard admin, metrics dashboards (Grafana already
  covers observability under `contrib/tilt/observability`).
- Production hardening / multi-tenant SaaS concerns.

---

## 2. Why a BFF (backend-for-frontend)

kcp is a Kubernetes-style API server exposed via the front-proxy at
`/clusters/<path>/apis/...`. A browser cannot talk to it directly in practice:

- **No CORS** — the apiserver emits no `Access-Control-Allow-Origin`, so
  cross-origin `fetch` is blocked.
- **No browser login** — kcp has no redirect/login flow; OIDC id_tokens must be
  obtained out-of-band (`kubectl oidc-login` today). A browser needs the auth
  code + PKCE dance handled somewhere.
- **TLS trust** — local/dev kcp uses a self-signed/cluster CA the browser won't
  trust; the front-proxy also expects specific client certs for shard hops.

A small **BFF proxy** solves all three: it terminates the OIDC login, holds the
token in a server-side session (httpOnly cookie to the browser), and reverse-
proxies plain Kubernetes REST to the front-proxy with the right CA/headers. It
also makes the OIDC/no-OIDC switch a one-line backend config change — the SPA is
identical in both modes.

```
Browser (Vue SPA)
  │  httpOnly session cookie, same-origin JSON/REST
  ▼
BFF (Node/TS)  ──OIDC auth-code+PKCE──►  Dex / IdP
  │  Bearer <id_token>  (or admin kubeconfig in no-oidc mode)
  │  CA-pinned HTTPS
  ▼
kcp front-proxy  /clusters/<path>/apis/...
```

---

## 3. kcp API surface the dashboard drives

All resources are **cluster-scoped, per-logical-cluster**. Base path is always
`/clusters/<path>/...` where `<path>` is a colon-delimited workspace path
(`root`, `root:org`, `root:org:team`) or a bare logical-cluster name, or `~`
for the caller's home workspace.

### Workspaces (`tenancy.kcp.io/v1alpha1`, kind `Workspace`, shortname `ws`)

- List children of `<path>`:
  `GET /clusters/<path>/apis/tenancy.kcp.io/v1alpha1/workspaces`
- Create child: `POST` a `Workspace` (`spec.type={name,path}`) into `<path>`.
- Delete child: `DELETE .../workspaces/<name>` (cascades to backing
  `LogicalCluster` via finalizer).
- Fields to surface: `spec.type.{name,path}`, `spec.URL` (the endpoint to
  descend into), `status.phase`
  (`Scheduling|Initializing|Ready|Unavailable|Inactive|Terminating|Deleting`),
  `status.conditions`, `metadata.labels.region`.
- Home workspace: `GET .../workspaces/~` against `root`, read `spec.URL`.
- **Descend** into a child = re-point the client base URL at the child's
  `spec.URL` (equivalently append `/clusters/<childPath>`).

Supporting types: `WorkspaceType` (defines allowed children/parents, default
API bindings — drives the "which type can I create here" dropdown),
`LogicalCluster` (backing object, always named `cluster`, has `status.URL`).

### APIExports (`apis.kcp.io`, **v1alpha2** is storage; also serve v1alpha1)

- `GET /clusters/<path>/apis/apis.kcp.io/v1alpha2/apiexports`
- v1alpha2 `spec.resources[]` = `{name, group, schema:"<ver>.<res>.<grp>",
  storage: crd{} | virtual{reference,identityHash}}`.
  (v1alpha1 used `spec.latestResourceSchemas []string` — support both; convert
  for display.)
- `spec.permissionClaims[]` = `{group, resource, verbs[], identityHash,
  defaultSelector}`.
- `spec.maximalPermissionPolicy`, `spec.identity.secretRef`.
- `status.identityHash` — **the linchpin** linking export ↔ claims ↔ bound
  resources; surface it prominently.

### APIResourceSchema (`apis.kcp.io/v1alpha1` only)

- Immutable, CRD-like. Name convention `<version>.<resource>.<group>`.
- `spec.{group,names,scope,versions[]}`; each version carries an OpenAPI v3
  schema (`runtime.RawExtension`) + printer columns. Used to render "what
  resources does this export provide."

### APIExportEndpointSlice (`apis.kcp.io/v1alpha1` only)

- `GET .../apiexportendpointslices`; read `status.endpoints[].url` — the
  authoritative virtual-workspace URLs for an export. Prefer this over the
  deprecated `APIExport.status.virtualWorkspaces`.
- VW URL shape:
  `<shard.VirtualWorkspaceURL>/services/apiexport/<export-cluster>/<export-name>`
  then normal k8s paths with a `/clusters/*` (wildcard) or `/clusters/<ws>`
  segment.

### APIBinding (`apis.kcp.io`, **v1alpha2** storage)

- `GET .../apibindings`; create with `spec.reference.export={path,name}`
  (needs `bind` verb on the export).
- `spec.permissionClaims[]` = `AcceptablePermissionClaim` = claim +
  `state: Accepted|Rejected` + selector (`matchAll` or labelSelector).
- `status.phase` (`""|Binding|Bound`), `status.boundResources[]`
  (`{group,resource,schema{name,UID,identityHash},storageVersions}`),
  `status.conditions` (`Ready`, `InitialBindingCompleted`, `BindingUpToDate`,
  `PermissionClaimsValid/Applied`).

### Discovery

The BFF can proxy `/clusters/<path>/apis` and `/openapi/v3` so the SPA can do
generic discovery later without hardcoding every GVK.

---

## 4. Authentication design

### OIDC mode (auth-code + PKCE, handled in the BFF)

1. Browser hits `/`; if no session → `302 /auth/login`.
2. BFF redirects to IdP `authorize` (PKCE). Dev IdP = Dex from
   `contrib/kcp-dex` (issuer `https://127.0.0.1:5556/dex`, client `kcp-dev`,
   scopes `openid email groups`).
3. Callback `/auth/callback` → BFF exchanges code for `id_token`/`refresh_token`,
   stores them in a server-side session, sets an httpOnly cookie.
4. Every proxied API call attaches `Authorization: Bearer <id_token>`; BFF
   refreshes on expiry using the refresh token.
5. kcp validates the JWT against its `--oidc-issuer-url`/`--oidc-client-id`
   (or structured `--authentication-config`), mapping `email`→user,
   `groups`→groups. The dashboard must be registered as a public client with the
   BFF callback in Dex `redirectURIs`.

The user's own RBAC in kcp governs what they can see/do — the dashboard shows only
what the token is authorized for; no elevated dashboard identity.

### No-OIDC mode (dev/demo)

- BFF loads a static kubeconfig (e.g. `.kcp/admin.kubeconfig`) — client-cert or
  token — and uses it for all upstream calls. No login screen; a banner marks
  the session as "admin (no-oidc)". Intended only for local Tilt/kind.

### Config surface (BFF env)

```
KCP_BASE_URL           https://<front-proxy host>
KCP_CA_FILE            path to front-proxy CA (or KCP_INSECURE=true for dev)
AUTH_MODE              oidc | none
OIDC_ISSUER_URL        https://127.0.0.1:5556/dex
OIDC_CLIENT_ID         kcp-dashboard
OIDC_CLIENT_SECRET     (public client; PKCE)
OIDC_REDIRECT_URL      http://localhost:8080/auth/callback
OIDC_SCOPES            openid email groups offline_access
KUBECONFIG             (no-oidc mode) path to admin kubeconfig
SESSION_SECRET         cookie signing key
```

---

## 5. Component & repo layout

```
contrib/dashboard/
  DESIGN.md                 (this file)
  README.md                 run instructions
  Makefile / package.json   workspaces: server + web
  docker/Dockerfile         multi-stage: build web → serve from BFF
  server/                   BFF (Node + TS, Fastify or Express)
    src/
      index.ts              app bootstrap, config
      auth/                 oidc.ts (openid-client), session.ts, mode.ts
      proxy/                kcp.ts — reverse proxy /api/kcp/* → front-proxy
      routes/               /auth/*, /api/session, health
    tsconfig.json
  web/                      Vue 3 + Vite + TS SPA
    src/
      main.ts, App.vue, router
      api/                  typed k8s client (fetch wrapper over BFF)
      types/                generated TS types for kcp CRDs
      stores/               Pinia: session, currentWorkspace, resources
      views/                Workspaces, WorkspaceDetail, APIExports,
                            APIExportDetail, APIBindings, BindingCreate, Login
      components/           WorkspaceTree, PhaseBadge, ClaimEditor, JSONView
    index.html, vite.config.ts
```

**Backend**: Node + TypeScript. Fastify + `@fastify/http-proxy` (or `http-proxy`)
for the reverse proxy, `openid-client` for OIDC/PKCE, `iron-session`/signed
cookie for sessions. The proxy forwards `/api/kcp/clusters/<path>/...` →
`<KCP_BASE_URL>/clusters/<path>/...`, injecting auth + CA and stripping the
session cookie.

**Frontend**: Vue 3 `<script setup>` + Vite + TS. Pinia for state, Vue Router
for views, `@tanstack/vue-query` for API caching/polling, Tailwind (+ a light
component kit) for UI. A thin typed client wraps `fetch` to the same-origin BFF.

**Types**: hand-write or codegen TS interfaces from the Go types in
`staging/src/github.com/kcp-dev/sdk/apis/{tenancy,core,apis}`. Start hand-written
for the ~6 kinds we touch; optionally script generation later from the CRD
OpenAPI.

---

## 5a. Navigation model

Two-pane layout, modelled on `kubectl ws tree`:

- **Left sidebar** — a lazily-loaded workspace tree. Each node lists its child
  `Workspaces` (via `.../workspaces` at that path), expandable on demand, with a
  phase dot. Selecting a node sets the app-wide current-workspace context
  (Pinia). Workspace lifecycle lives here too: a **create** form docked at the
  bottom (targets the selected workspace, WorkspaceType-driven) and a hover-×
  **delete** on each non-root node. Expansion state + a reload signal live in
  the store.
- **Main pane** — fully dedicated to the selected workspace's resources: a
  two-item menu (APIExports / APIBindings); each view reads the shared current
  path.

## 6. Key flows

**Workspace navigation** — Pinia `currentWorkspace` holds the active path.
Tree view lists children via `.../workspaces` at each level (lazy-load on
expand). Selecting a workspace sets the path; all subsequent resource calls go
to `/api/kcp/clusters/<path>/...`. Breadcrumb from the colon-split path.

**Create workspace** — modal: name + type (types fetched from `WorkspaceType`,
filtered by parent's `limitAllowedChildren`); POST `Workspace`; poll
`status.phase` until `Ready`.

**APIExport detail** — show `spec.resources`/`latestResourceSchemas`, resolve
each referenced `APIResourceSchema` (versions, columns), list permission claims
with `identityHash`, and the endpoint-slice VW URLs.

**Create APIBinding** — pick an export (by path+name), render its
`permissionClaims` as an accept/reject editor (`ClaimEditor`, with `matchAll` or
label selector), POST the binding, watch `status.phase`/`Ready` and show
`boundResources` when bound.

---

## 7. Local dev integration

- Reuse **Dex** from `contrib/kcp-dex` as the OIDC issuer; add a `kcp-dashboard`
  static client (redirect `http://localhost:8080/auth/callback`, public+PKCE).
- Add a **Tilt** resource under `contrib/tilt` (or a `dashboard.Tiltfile`) that
  builds `contrib/dashboard` and wires `KCP_BASE_URL` to the in-cluster front-proxy
  and `OIDC_ISSUER_URL` to Dex — following the self-contained-scenario
  convention of `contrib/`.
- `README.md`: `npm install && npm run dev` for a standalone run against a
  kubeconfig (no-oidc), plus the Tilt path for the full OIDC loop.

---

## 8. Milestones

1. **Scaffold** ✅ — repo layout, BFF that proxies `/api/kcp/*` using a static
   kubeconfig (no-oidc), Vue app shell + routing. *Exit:* list workspaces under
   `root` in the browser.
2. **Workspace management** ✅ — tree navigation via breadcrumb + drill-in,
   create (WorkspaceType-driven dropdown), delete, context switch, and
   auto-poll of freshly-created workspaces to Ready. *TODO (later):* richer
   detail panel (conditions/initializers).
3. **OIDC** ✅ — auth-code+PKCE in the BFF (openid-client v6), server-side
   session, id_token forwarded upstream, pre-emptive refresh, SPA login gate +
   sign-out. Dex run instructions in README. *Unverified live* (needs Dex+kcp
   up): the token exchange itself.
4. **APIExport views** ✅ — list + inline detail (resources normalized across
   v1alpha1/v1alpha2, permission claims, identityHash, endpoint-slice VW URLs).
   *TODO:* resolve APIResourceSchema OpenAPI for a full resource view.
5. **APIBinding management** ✅ — list, delete, create-binding flow that loads
   the referenced export's claims into an accept/reject editor.
6. **Polish & dev-integration** 🟡 — multi-stage Dockerfile, in-cluster
   Deployment/Service (`deploy/`), opt-in Tilt wiring
   (`KCP_DASHBOARD_ENABLED=true`), and a GitHub Actions image build/publish
   workflow — all done and image verified end-to-end. *TODO:* watch/SSE instead
   of manual refresh, generic resource viewer groundwork.

---

## 9. Open questions / risks

- **Watch vs poll**: k8s `?watch=true` is a long-lived chunked stream; simplest
  is BFF-side SSE bridge, but MVP can poll via vue-query. Decide in milestone 2.
- **v1alpha1 vs v1alpha2** dual-serving for apis.kcp.io — display-normalize in
  the client; write v1alpha2.
- **Front-proxy CA / client-cert** specifics per deploy — surfaced as BFF config;
  `KCP_INSECURE` escape hatch for dev only.
- **Per-workspace OIDC** (`WorkspaceAuthentication` feature) — out of scope for
  MVP but the token-forwarding BFF is compatible with it.
```

