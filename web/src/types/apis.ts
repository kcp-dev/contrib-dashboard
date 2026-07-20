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

export interface APIExport {
  apiVersion: string;
  kind: "APIExport";
  metadata: ObjectMeta;
  spec: {
    // v1alpha2
    resources?: ResourceSchema[];
    // v1alpha1 (legacy) — list of APIResourceSchema object names.
    latestResourceSchemas?: string[];
    permissionClaims?: PermissionClaim[];
    identity?: { secretRef?: { name: string; namespace?: string } };
  };
  status?: {
    identityHash?: string;
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
    phase?: "" | "Binding" | "Bound";
    apiExportClusterName?: string;
    boundResources?: BoundAPIResource[];
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

// True if a condition of type "Ready" is present and True.
export function isReady(conditions?: Condition[]): boolean {
  return !!conditions?.some((c) => c.type === "Ready" && c.status === "True");
}
