// TypeScript views of apis.kcp.io kinds: APIExport, APIBinding,
// APIResourceSchema, APIExportEndpointSlice.
//
// Note the version split:
//   - APIExport / APIBinding  -> served as v1alpha1 AND v1alpha2 (v1alpha2 is
//     storage). The dashboard reads/writes v1alpha2 but tolerates v1alpha1 shapes.
//   - APIResourceSchema / APIExportEndpointSlice -> v1alpha1 only.

import type { ObjectMeta, Condition } from "./kcp";

export const APIS_GROUP = "apis.kcp.io";
export const APIS_V2 = "v1alpha2";
export const APIS_V1 = "v1alpha1";

// ---- APIExport (v1alpha2) ----

export interface ResourceSchema {
  name: string;
  group: string;
  schema: string;
  storage?: { crd?: Record<string, never>; virtual?: unknown };
}

export interface PermissionClaim {
  group?: string;
  resource: string;
  verbs?: string[];
  identityHash?: string;
}

export interface APIExport {
  apiVersion: string;
  kind: "APIExport";
  metadata: ObjectMeta;
  spec: {
    resources?: ResourceSchema[];
    latestResourceSchemas?: string[];
    permissionClaims?: PermissionClaim[];
    identity?: { secretRef?: { name: string; namespace?: string } };
  };
  status?: {
    identityHash?: string;
    // Legacy VW URLs (pre-APIExportEndpointSlice). Still used by some versions.
    virtualWorkspaces?: { url: string }[];
    conditions?: Condition[];
  };
}

// ---- APIBinding (v1alpha2) ----

export interface AcceptablePermissionClaim extends PermissionClaim {
  state: "Accepted" | "Rejected";
  selector?: { matchAll?: boolean; matchLabels?: Record<string, string> };
}

export interface BoundAPIResource {
  group: string;
  resource: string;
  schema?: { name: string; UID?: string; identityHash?: string };
  storageVersions?: string[];
}

export interface APIBinding {
  apiVersion: string;
  kind: "APIBinding";
  metadata: ObjectMeta;
  spec: {
    reference: { export?: { path?: string; name: string } };
    permissionClaims?: AcceptablePermissionClaim[];
  };
  status?: {
    // "" | "Binding" | "Bound"
    phase?: "" | "Binding" | "Bound";
    apiExportClusterName?: string;
    boundResources?: BoundAPIResource[];
    appliedPermissionClaims?: PermissionClaim[];
    exportPermissionClaims?: PermissionClaim[];
    conditions?: Condition[];
  };
}

// ---- APIExportEndpointSlice (v1alpha1) ----

export interface APIExportEndpointSlice {
  apiVersion: string;
  kind: "APIExportEndpointSlice";
  metadata: ObjectMeta;
  spec: { export?: { path?: string; name: string }; partition?: string };
  status?: {
    endpoints?: { url: string }[];
    conditions?: Condition[];
  };
}

// ---- APIResourceSchema (v1alpha1) ----

export interface APIResourceSchema {
  apiVersion: string;
  kind: "APIResourceSchema";
  metadata: ObjectMeta;
  spec: {
    group: string;
    names: { kind: string; plural: string; singular?: string };
    scope: "Cluster" | "Namespaced";
    versions?: { name: string; served: boolean; storage: boolean }[];
  };
}

// ── Condition helpers ─────────────────────────────────────────────────────────

// KCP may send condition status as string "True" or boolean true.
function condTrue(c: Condition): boolean {
  return c.status === "True" || (c.status as unknown) === true;
}

function findCond(conditions: Condition[] | undefined, type: string): Condition | undefined {
  return conditions?.find(c => c.type === type);
}

export function isReady(conditions?: Condition[]): boolean {
  const c = findCond(conditions, "Ready");
  return !!c && condTrue(c);
}

// ── APIExport status ──────────────────────────────────────────────────────────
//
// Condition types on APIExport (from kcp source):
//   Ready                  — overall readiness
//   IdentityValid          — identity secret present and valid
//   VirtualWorkspaceURLsReady — endpoint URLs provisioned

export interface APIExportStatus {
  ready: boolean;
  identityValid: boolean;
  virtualWorkspacesReady: boolean;
  // Human label for the primary phase badge
  phase: string;
  // condition messages for tooltip / detail (undefined = condition absent)
  identityMessage?: string;
  vwMessage?: string;
  readyMessage?: string;
}

export function apiExportStatus(ex: APIExport): APIExportStatus {
  const conds = ex.status?.conditions ?? [];

  const readyCond = findCond(conds, "Ready");
  const identCond = findCond(conds, "IdentityValid");
  const vwCond    = findCond(conds, "VirtualWorkspaceURLsReady");

  const identityValid          = !!identCond && condTrue(identCond);
  const virtualWorkspacesReady = vwCond ? condTrue(vwCond) : undefined;

  // KCP does not always emit a Ready condition — derive readiness:
  //   • explicit Ready=True  → Ready
  //   • explicit Ready=False → use reason for label
  //   • no Ready condition:
  //       IdentityValid=True → infer Ready (export is functional)
  //       IdentityValid=False → No identity
  //       no conditions at all → Unknown
  let phase: string;
  if (readyCond) {
    if (condTrue(readyCond)) {
      phase = "Ready";
    } else {
      const reason = readyCond.reason ?? "";
      if (reason.includes("Identity"))       phase = "No identity";
      else if (reason.includes("Virtual") || reason.includes("Endpoint")) phase = "No endpoints";
      else                                   phase = reason || "Not ready";
    }
  } else if (!conds.length) {
    phase = "Unknown";
  } else if (identityValid) {
    // IdentityValid=True with no explicit Ready=False → treat as Ready
    phase = "Ready";
  } else if (identCond && !identityValid) {
    phase = "No identity";
  } else {
    phase = "Unknown";
  }

  const ready = phase === "Ready";

  return {
    ready,
    identityValid,
    virtualWorkspacesReady: virtualWorkspacesReady ?? ready,
    phase,
    identityMessage: identCond?.message,
    vwMessage: vwCond?.message,
    readyMessage: readyCond?.message,
  };
}

// ── APIBinding status ─────────────────────────────────────────────────────────
//
// Condition types on APIBinding (from kcp source):
//   Ready                       — overall readiness (from printcolumn)
//   APIExportValid              — referenced export is reachable
//   InitialBindingCompleted     — first bind cycle done
//   BindingUpToDate             — schema is current
//   PermissionClaimsValid       — spec claims are valid
//   PermissionClaimsApplied     — claims have been applied
//
// Phases: "" → Binding → Bound

export interface APIBindingStatus {
  phase: "" | "Binding" | "Bound";
  ready: boolean;
  exportValid: boolean;
  bindingCompleted: boolean;
  upToDate: boolean;
  claimsValid: boolean;
  claimsApplied: boolean;
  // badge label
  label: string;
  messages: { type: string; ok: boolean; message?: string }[];
}

export function apiBindingStatus(b: APIBinding): APIBindingStatus {
  const conds = b.status?.conditions;
  const phase = (b.status?.phase ?? "") as "" | "Binding" | "Bound";

  const readyCond    = findCond(conds, "Ready");
  const exportValid  = condTrue(findCond(conds, "APIExportValid") ?? { status: "False" } as Condition);
  const bindingDone  = condTrue(findCond(conds, "InitialBindingCompleted") ?? { status: "False" } as Condition);
  const upToDate     = condTrue(findCond(conds, "BindingUpToDate") ?? { status: "False" } as Condition);
  const claimsValid  = condTrue(findCond(conds, "PermissionClaimsValid") ?? { status: "False" } as Condition);
  const claimsApplied = condTrue(findCond(conds, "PermissionClaimsApplied") ?? { status: "False" } as Condition);
  const ready = !!readyCond && condTrue(readyCond);

  let label: string;
  if (phase === "Bound" && ready)  label = "Bound";
  else if (phase === "Bound")      label = "Degraded";
  else if (phase === "Binding")    label = "Binding";
  else if (!exportValid)           label = "Export invalid";
  else                             label = "Pending";

  const messages = [
    { type: "Export reachable",       ok: exportValid,   message: findCond(conds, "APIExportValid")?.message },
    { type: "Initial binding done",   ok: bindingDone,   message: findCond(conds, "InitialBindingCompleted")?.message },
    { type: "Schema up to date",      ok: upToDate,      message: findCond(conds, "BindingUpToDate")?.message },
    { type: "Claims valid",           ok: claimsValid,   message: findCond(conds, "PermissionClaimsValid")?.message },
    { type: "Claims applied",         ok: claimsApplied, message: findCond(conds, "PermissionClaimsApplied")?.message },
  ];

  return { phase, ready, exportValid, bindingCompleted: bindingDone, upToDate, claimsValid, claimsApplied, label, messages };
}


// ---- APIExport (v1alpha2) ----

export interface ResourceSchema {
  name: string;
  group: string;
  // "<version>.<resource>.<group>" reference to an APIResourceSchema object.
  schema: string;
  storage?: { crd?: Record<string, never>; virtual?: unknown };
}

export interface PermissionClaim {
  group?: string;
  resource: string;
  verbs?: string[];
  identityHash?: string;
}

