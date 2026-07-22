import { http, HttpResponse, delay } from "msw";
import {
  WORKSPACES, WORKSPACE_TYPES, API_EXPORTS, API_BINDINGS,
  CORE_RESOURCES, API_GROUPS, GROUP_RESOURCES, OBJECTS, list,
} from "./fixtures";
import type { Workspace } from "../types/kcp";
import type { APIBinding } from "../types/apis";

// Simulate slight network latency so the UI feels real
const LAT = () => delay(Math.floor(Math.random() * 180 + 60));

// Mutable in-memory state so create/delete actually work in the demo
const ws   = structuredClone(WORKSPACES) as Record<string, Workspace[]>;
const bindings = structuredClone(API_BINDINGS) as Record<string, APIBinding[]>;

// Helper: decode %3A-encoded cluster path back to "root:foo:bar"
function decodePath(p: string) { return decodeURIComponent(p); }

// ── Session ───────────────────────────────────────────────────────────────────
const sessionHandler = http.get("/api/session", async () => {
  await LAT();
  return HttpResponse.json({
    authMode: "none",
    authenticated: true,
    user: { username: "demo-user", groups: ["system:masters"], email: "demo@kcp.io" },
  });
});

// ── Workspaces ────────────────────────────────────────────────────────────────
const listWorkspacesHandler = http.get(
  "/api/kcp/clusters/:path/apis/tenancy.kcp.io/v1alpha1/workspaces",
  async ({ params }) => {
    await LAT();
    const path = decodePath(params.path as string);
    const items = ws[path] ?? [];
    return HttpResponse.json(list("WorkspaceList", items));
  },
);

const listWorkspaceTypesHandler = http.get(
  "/api/kcp/clusters/:path/apis/tenancy.kcp.io/v1alpha1/workspacetypes",
  async () => {
    await LAT();
    return HttpResponse.json(list("WorkspaceTypeList", WORKSPACE_TYPES));
  },
);

const createWorkspaceHandler = http.post(
  "/api/kcp/clusters/:path/apis/tenancy.kcp.io/v1alpha1/workspaces",
  async ({ params, request }) => {
    await LAT();
    const path = decodePath(params.path as string);
    const body = await request.json() as Workspace;
    const name = body.metadata.name;

    if (!ws[path]) ws[path] = [];
    // Start as Initializing, then transition to Ready after 3s
    const newWs: Workspace = {
      apiVersion: "tenancy.kcp.io/v1alpha1",
      kind: "Workspace",
      metadata: { name, uid: Math.random().toString(36).slice(2), creationTimestamp: new Date().toISOString() },
      spec: body.spec,
      status: { phase: "Initializing" },
    };
    ws[path].push(newWs);
    ws[`${path}:${name}`] = [];

    // Transition to Ready after 3 seconds (simulates KCP reconciliation)
    setTimeout(() => {
      const w = ws[path]?.find(w => w.metadata.name === name);
      if (w) {
        w.status = {
          phase: "Ready",
          conditions: [{ type: "Ready", status: "True", reason: "Ready", lastTransitionTime: new Date().toISOString() }],
        };
      }
    }, 3000);

    return HttpResponse.json(newWs, { status: 201 });
  },
);

const deleteWorkspaceHandler = http.delete(
  "/api/kcp/clusters/:path/apis/tenancy.kcp.io/v1alpha1/workspaces/:name",
  async ({ params }) => {
    await LAT();
    const path = decodePath(params.path as string);
    const name = params.name as string;
    if (ws[path]) {
      ws[path] = ws[path].filter(w => w.metadata.name !== name);
    }
    delete ws[`${path}:${name}`];
    return HttpResponse.json({ kind: "Status", status: "Success" });
  },
);

// ── APIExports ────────────────────────────────────────────────────────────────
const listAPIExportsHandler = http.get(
  "/api/kcp/clusters/:path/apis/apis.kcp.io/v1alpha2/apiexports",
  async ({ params }) => {
    await LAT();
    const path = decodePath(params.path as string);
    const items = API_EXPORTS[path] ?? [];
    return HttpResponse.json(list("APIExportList", items));
  },
);

// ── APIExportEndpointSlices (return empty — not used in demo heavily) ─────────
const listEndpointSlicesHandler = http.get(
  "/api/kcp/clusters/:path/apis/apis.kcp.io/v1alpha1/apiexportendpointslices",
  async () => {
    await LAT();
    return HttpResponse.json(list("APIExportEndpointSliceList", []));
  },
);

// ── APIBindings ───────────────────────────────────────────────────────────────
const listAPIBindingsHandler = http.get(
  "/api/kcp/clusters/:path/apis/apis.kcp.io/v1alpha2/apibindings",
  async ({ params }) => {
    await LAT();
    const path = decodePath(params.path as string);
    const items = bindings[path] ?? [];
    return HttpResponse.json(list("APIBindingList", items));
  },
);

const createAPIBindingHandler = http.post(
  "/api/kcp/clusters/:path/apis/apis.kcp.io/v1alpha2/apibindings",
  async ({ params, request }) => {
    await LAT();
    const path = decodePath(params.path as string);
    const body = await request.json() as APIBinding;
    const newBinding: APIBinding = {
      ...body,
      metadata: { ...body.metadata, uid: Math.random().toString(36).slice(2), creationTimestamp: new Date().toISOString() },
      status: { phase: "Binding", boundResources: [], conditions: [
        { type: "APIExportValid", status: "True", reason: "Valid", lastTransitionTime: new Date().toISOString() },
      ]},
    };
    if (!bindings[path]) bindings[path] = [];
    bindings[path].push(newBinding);

    // Transition to Bound after 4s
    setTimeout(() => {
      const b = bindings[path]?.find(b => b.metadata.name === body.metadata.name);
      if (b) {
        b.status = {
          phase: "Bound",
          boundResources: [{ group: "example.com", resource: "examples" }],
          conditions: [
            { type: "Ready",                   status: "True", reason: "Ready",                   lastTransitionTime: new Date().toISOString() },
            { type: "APIExportValid",           status: "True", reason: "Valid",                   lastTransitionTime: new Date().toISOString() },
            { type: "InitialBindingCompleted",  status: "True", reason: "InitialBindingCompleted", lastTransitionTime: new Date().toISOString() },
            { type: "BindingUpToDate",          status: "True", reason: "BindingUpToDate",          lastTransitionTime: new Date().toISOString() },
            { type: "PermissionClaimsValid",    status: "True", reason: "Valid",                   lastTransitionTime: new Date().toISOString() },
            { type: "PermissionClaimsApplied",  status: "True", reason: "Applied",                 lastTransitionTime: new Date().toISOString() },
          ],
        };
      }
    }, 4000);

    return HttpResponse.json(newBinding, { status: 201 });
  },
);

const deleteAPIBindingHandler = http.delete(
  "/api/kcp/clusters/:path/apis/apis.kcp.io/v1alpha2/apibindings/:name",
  async ({ params }) => {
    await LAT();
    const path = decodePath(params.path as string);
    const name = params.name as string;
    if (bindings[path]) {
      bindings[path] = bindings[path].filter(b => b.metadata.name !== name);
    }
    return HttpResponse.json({ kind: "Status", status: "Success" });
  },
);

// ── Discovery ─────────────────────────────────────────────────────────────────
const coreResourcesHandler = http.get(
  "/api/kcp/clusters/:path/api/v1",
  async () => {
    await LAT();
    return HttpResponse.json(CORE_RESOURCES);
  },
);

const apiGroupsHandler = http.get(
  "/api/kcp/clusters/:path/apis",
  async () => {
    await LAT();
    return HttpResponse.json(API_GROUPS);
  },
);

const groupResourcesHandler = http.get(
  "/api/kcp/clusters/:path/apis/:group/:version",
  async ({ params }) => {
    await LAT();
    const gv = `${params.group}/${params.version}`;
    const data = GROUP_RESOURCES[gv];
    if (!data) return HttpResponse.json({ groupVersion: gv, resources: [] });
    return HttpResponse.json(data);
  },
);

// Generic list objects handler — returns sample objects keyed by resource name
const META_KEYS = new Set(["name", "namespace", "creationTimestamp", "labels", "annotations", "managedFields"]);
const listObjectsHandler = http.get(
  "/api/kcp/clusters/:path/apis/:group/:version/:resource",
  async ({ params }) => {
    await LAT();
    const resource = params.resource as string;
    const items = (OBJECTS[resource] ?? []).map(o => {
      const meta = Object.fromEntries(Object.entries(o).filter(([k]) => META_KEYS.has(k)));
      const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !META_KEYS.has(k)));
      return {
        apiVersion: `${params.group}/${params.version}`,
        kind: resource.slice(0, -1).replace(/^\w/, c => c.toUpperCase()),
        metadata: meta,
        ...rest,
      };
    });
    return HttpResponse.json({ apiVersion: "v1", kind: "List", metadata: {}, items });
  },
);

const listCoreObjectsHandler = http.get(
  "/api/kcp/clusters/:path/api/v1/:resource",
  async ({ params }) => {
    await LAT();
    const resource = params.resource as string;
    const items = (OBJECTS[resource] ?? []).map(o => {
      const meta = Object.fromEntries(Object.entries(o).filter(([k]) => META_KEYS.has(k)));
      const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !META_KEYS.has(k)));
      return {
        apiVersion: "v1",
        kind: resource.slice(0, -1).replace(/^\w/, c => c.toUpperCase()),
        metadata: meta,
        ...rest,
      };
    });
    return HttpResponse.json({ apiVersion: "v1", kind: "List", metadata: {}, items });
  },
);

export const handlers = [
  sessionHandler,
  listWorkspacesHandler,
  listWorkspaceTypesHandler,
  createWorkspaceHandler,
  deleteWorkspaceHandler,
  listAPIExportsHandler,
  listEndpointSlicesHandler,
  listAPIBindingsHandler,
  createAPIBindingHandler,
  deleteAPIBindingHandler,
  coreResourcesHandler,
  apiGroupsHandler,
  groupResourcesHandler,
  listObjectsHandler,
  listCoreObjectsHandler,
];
