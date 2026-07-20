# kcp dashboard (contrib-dashboard)

A web UI for kcp: workspace navigation/management, an APIExport / APIBinding
manager, and a discovery-driven object browser — with OIDC or no-OIDC auth.

This is a standalone repository (`github.com/kcp-dev/contrib-dashboard`); it
talks to a kcp cluster over the front-proxy and is developed and released
independently of kcp.

See [DESIGN.md](./DESIGN.md) for the architecture and roadmap.

## Layout

- `server/` — BFF (Node + TypeScript + Express). Terminates OIDC (later) and
  reverse-proxies Kubernetes REST to the kcp front-proxy.
- `web/` — SPA (Vue 3 + Vite + TypeScript).

## Prerequisites

- Node.js >= 20
- A running kcp and a kubeconfig that can reach it. The dev default is
  `.kcp/admin.kubeconfig` (created by `kcp start`).

## Quick start (no-oidc, against a kubeconfig)

```bash
npm install

# Point the BFF at your kcp admin kubeconfig (no-oidc mode is the default).
export AUTH_MODE=none
export KUBECONFIG=/path/to/kcp/.kcp/admin.kubeconfig   # e.g. your kcp checkout
export KCP_INSECURE=true                               # dev self-signed CA

npm run dev
```

- BFF listens on `:8080`, SPA (Vite dev server) on `:5173`.
- Open <http://localhost:5173> — you should see the workspaces under `root`.

The Vite dev server proxies `/api`, `/auth` and `/api/kcp` back to the BFF, so
the SPA runs same-origin.

## OIDC mode (login via Dex)

The BFF terminates OIDC (auth-code + PKCE); the SPA never sees tokens. Uses a
Dex issuer — the kcp repo ships a ready one at `contrib/kcp-dex`.

1. Register a dashboard client in Dex. Add to the Dex config `staticClients:`

   ```yaml
   - id: kcp-dashboard
     public: true                       # public client, PKCE
     name: 'kcp dashboard'
     redirectURIs:
       - http://localhost:8080/auth/callback
   ```

2. Start kcp with matching OIDC flags (audience/client `kcp-dashboard`, or reuse
   your existing structured `auth-config.yaml` and add the audience). See the
   kcp repo's `contrib/kcp-dex/README.md`.

3. Run the dashboard in oidc mode:

   ```bash
   export AUTH_MODE=oidc
   export KCP_BASE_URL=https://127.0.0.1:6443
   export KCP_INSECURE=true                       # dev self-signed kcp + Dex
   export OIDC_ISSUER_URL=https://127.0.0.1:5556/dex
   export OIDC_CLIENT_ID=kcp-dashboard
   export OIDC_REDIRECT_URL=http://localhost:8080/auth/callback
   npm run dev
   ```

   Open <http://localhost:5173>, click **Sign in**, authenticate in Dex
   (`admin` / `password` in the sample config). The dashboard then acts with your
   identity — you only see workspaces/resources your token is authorized for.

`KCP_INSECURE=true` skips TLS verification for **both** the upstream kcp and the
Dex issuer (dev only).

## Run in the Tilt / kind dev environment

The [`Tiltfile`](./Tiltfile) is a **standalone dev environment**: it stands up a
static kcp using kcp's tilt library (`deploy_kcp` from `kcp_static.Tiltfile`) and
deploys the dashboard on top, so one command gives you kcp + the dashboard.

It needs a local kcp checkout for the tilt library and infra manifests. Point
`KCP_DIR` at it (default `../kcp`, i.e. a sibling clone under `.../kcp-dev/`):

```bash
make tilt-up                     # creates the kind cluster (if needed), then tilt up
# or, if you already have a cluster:
tilt up                          # uses ../kcp
KCP_DIR=/path/to/kcp tilt up
```

`make tilt-up` also warns if the `*.kcp.localhost` names don't resolve; add them
to `/etc/hosts` as it instructs (`127.0.0.1 kcp.localhost root.kcp.localhost
theseus.kcp.localhost dex.kcp.localhost`).

Options:

- `KCP_SINGLE_SHARD=true` — skip the second (theseus) shard for a leaner cluster.
- `KCP_OIDC_ENABLED=true` — run in **OIDC mode** with an in-cluster Dex (see below).

Tilt brings up cert-manager, the envoy gateway, etcd, the kcp-operator, the kcp
shards + front-proxy, extracts the admin kubeconfig, then builds and deploys the
dashboard — port-forwarded to <http://localhost:8080> (no-oidc). It runs in no-oidc
mode by mounting the operator-published `kcp-frontproxy-kubeconfig` secret and
proxying to the in-cluster front-proxy Service; it waits for the `kcp-admin
extract` step so the secret exists first.

### OIDC mode (in-cluster Dex)

```bash
make tilt-up-oidc                # == KCP_OIDC_ENABLED=true make tilt-up
```

This additionally deploys **Dex** in the cluster (via [`dex.Tiltfile`](./dex.Tiltfile)),
served through the same envoy gateway at `https://dex.kcp.localhost:8443/dex`,
configures kcp to trust it (`deploy_kcp(oidc=...)`, with kcp's `caFileRef` pointing
at Dex's cert-manager cert), and runs the dashboard from
[`deploy/deployment-oidc.yaml`](./deploy/deployment-oidc.yaml) in `AUTH_MODE=oidc`.

Open <http://localhost:8080>, click **Sign in**, and log in with **`admin` /
`password`** (the sample static user). The issuer URL
`https://dex.kcp.localhost:8443/dex` is one identical string for the browser (via
`/etc/hosts`), the BFF, and kcp — the pods resolve it to the gateway through a
`hostAlias`, so add the `dex.kcp.localhost` entry to `/etc/hosts` above.

**Admin rights:** the Dex dev user is in the `system:kcp:admin` group, which
kcp's bootstrap policy binds to `cluster-admin` — so the OIDC identity gets kcp
admin straight from the token, no extra RBAC. This needs **dex ≥ v2.45.0**
(`staticPasswords` gained a `groups` field then; the pinned image in
[`dex.Tiltfile`](./dex.Tiltfile) is `v2.45.1`). Older dex silently drops the
field and the user lands with only `system:authenticated`.

> Dex uses in-memory storage, so restarting the dex pod rotates its signing
> keys. kcp refetches Dex's JWKS on its own, but if a token briefly fails with
> `failed to verify id token signature` right after a dex restart, give it a
> minute or `kubectl rollout restart deploy/frontproxy-front-proxy`.

**Reusing Dex from kcp's own Tilt:** `dex.Tiltfile` is self-contained (Starlark
only, no sibling-file reads), so kcp's `contrib/tilt` Tiltfiles can load it the
same way:

```python
deploy_dex = load_dynamic('.../contrib-dashboard/dex.Tiltfile')['deploy_dex']
oidc = deploy_dex()   # returns the dict deploy_kcp(oidc=...) expects
deploy_kcp(..., hostnames=[..., 'dex.kcp.localhost'], oidc=oidc)
```

## Container image & CI

- `Dockerfile` is a multi-stage build (SPA + BFF → slim runtime that serves
  `web/dist` and proxies REST). Build locally: `docker build -t kcp-dashboard .`.
- `.github/workflows/dashboard-image.yaml` builds the image on every PR (which also
  verifies the TypeScript build) and pushes to
  `ghcr.io/<owner>/contrib-dashboard` on `main` and version tags.

## Configuration (BFF env)

| Var | Meaning |
| --- | --- |
| `PORT` | BFF port (default `8080`) |
| `AUTH_MODE` | `none` (kubeconfig) or `oidc` |
| `KUBECONFIG` | kubeconfig path for no-oidc mode |
| `KCP_BASE_URL` | upstream front-proxy base URL (oidc mode, or to override) |
| `KCP_CA_FILE` | CA bundle to trust for the upstream |
| `KCP_INSECURE` | `true` to skip upstream TLS verification (dev only) |
| `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | OIDC client (oidc mode) |
| `OIDC_REDIRECT_URL` | OIDC callback (default `http://localhost:$PORT/auth/callback`) |
| `SESSION_SECRET` | cookie signing key |

## Production build

```bash
npm run build     # builds web → web/dist, compiles server → server/dist
npm start         # BFF serves the built SPA and the API on :8080
```
