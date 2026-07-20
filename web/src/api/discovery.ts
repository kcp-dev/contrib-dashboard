// Workspace API discovery: enumerate the resource types served in a workspace
// (via the Kubernetes discovery endpoints) and classify each by origin —
// native k8s, kcp system, a locally-defined CRD, or provided by an APIBinding.

import { api, kcpUrl } from "./client";
import type { List } from "../types/kcp";
import { listAPIBindings } from "./apis";

export type ResourceOrigin = "native" | "kcp" | "crd" | "apibinding";

export interface APIResourceInfo {
  group: string;
  version: string;
  groupVersion: string; // "v1" for core, "<group>/<version>" otherwise
  name: string; // plural resource name
  kind: string;
  namespaced: boolean;
  verbs: string[];
  origin: ResourceOrigin;
}

// Built-in Kubernetes API groups present in every workspace.
const NATIVE_GROUPS = new Set([
  "",
  "apps",
  "batch",
  "autoscaling",
  "policy",
  "rbac.authorization.k8s.io",
  "apiextensions.k8s.io",
  "apiregistration.k8s.io",
  "authentication.k8s.io",
  "authorization.k8s.io",
  "certificates.k8s.io",
  "coordination.k8s.io",
  "events.k8s.io",
  "admissionregistration.k8s.io",
  "flowcontrol.apiserver.k8s.io",
  "scheduling.k8s.io",
  "storage.k8s.io",
  "node.k8s.io",
  "discovery.k8s.io",
]);

interface RawAPIResource {
  name: string;
  namespaced: boolean;
  kind: string;
  verbs?: string[];
}
interface RawResourceList {
  groupVersion: string;
  resources: RawAPIResource[];
}
interface RawGroup {
  name: string;
  preferredVersion?: { groupVersion: string; version: string };
  versions?: { groupVersion: string; version: string }[];
}

function classify(
  group: string,
  resource: string,
  bound: Set<string>,
): ResourceOrigin {
  if (bound.has(`${group}/${resource}`)) return "apibinding";
  if (NATIVE_GROUPS.has(group)) return "native";
  if (group === "kcp.io" || group.endsWith(".kcp.io")) return "kcp";
  return "crd";
}

async function boundResourceKeys(cluster: string): Promise<Set<string>> {
  try {
    const list = await listAPIBindings(cluster);
    const keys = new Set<string>();
    for (const b of list.items ?? []) {
      for (const r of b.status?.boundResources ?? []) {
        keys.add(`${r.group}/${r.resource}`);
      }
    }
    return keys;
  } catch {
    return new Set();
  }
}

// Discover every listable (non-subresource) resource type in the workspace.
export async function discoverResources(
  cluster: string,
): Promise<APIResourceInfo[]> {
  const [bound, core, groups] = await Promise.all([
    boundResourceKeys(cluster),
    api
      .get<RawResourceList>(kcpUrl(cluster, "api/v1"))
      .catch(() => null),
    api
      .get<{ groups: RawGroup[] }>(kcpUrl(cluster, "apis"))
      .catch(() => ({ groups: [] as RawGroup[] })),
  ]);

  // Fetch each group's preferred version resource list in parallel.
  const gvs = (groups.groups ?? [])
    .map((g) => g.preferredVersion?.groupVersion)
    .filter((gv): gv is string => !!gv);

  const groupLists = await Promise.all(
    gvs.map((gv) =>
      api.get<RawResourceList>(kcpUrl(cluster, `apis/${gv}`)).catch(() => null),
    ),
  );

  const out: APIResourceInfo[] = [];
  const push = (rl: RawResourceList | null) => {
    if (!rl) return;
    const [g, v] = splitGroupVersion(rl.groupVersion);
    for (const r of rl.resources) {
      if (r.name.includes("/")) continue; // skip subresources
      if (!(r.verbs ?? []).includes("list")) continue;
      out.push({
        group: g,
        version: v,
        groupVersion: rl.groupVersion,
        name: r.name,
        kind: r.kind,
        namespaced: r.namespaced,
        verbs: r.verbs ?? [],
        origin: classify(g, r.name, bound),
      });
    }
  };

  push(core);
  groupLists.forEach(push);

  return out.sort(
    (a, b) =>
      a.group.localeCompare(b.group) || a.kind.localeCompare(b.kind),
  );
}

function splitGroupVersion(gv: string): [string, string] {
  const i = gv.indexOf("/");
  return i < 0 ? ["", gv] : [gv.slice(0, i), gv.slice(i + 1)];
}

// Collection path for listing objects of a resource type.
function collectionPath(res: APIResourceInfo): string {
  return res.group
    ? `apis/${res.groupVersion}/${res.name}`
    : `api/${res.version}/${res.name}`;
}

export interface GenericObject {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    namespace?: string;
    creationTimestamp?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export function listObjects(
  cluster: string,
  res: APIResourceInfo,
): Promise<List<GenericObject>> {
  return api.get<List<GenericObject>>(kcpUrl(cluster, collectionPath(res)));
}
