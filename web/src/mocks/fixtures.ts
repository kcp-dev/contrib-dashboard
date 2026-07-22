// Demo fixture data — realistic kcp workspace tree with exports, bindings, and
// discovery data derived from the official kcp documentation.


import type { Workspace, WorkspaceType, List } from "../types/kcp";
import type { APIExport, APIBinding } from "../types/apis";

const ts = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const uid = () =>
  Math.random().toString(36).slice(2, 10) +
  "-" +
  Math.random().toString(36).slice(2, 10);

function ws(
  name: string,
  type: string = "universal",
  phase: NonNullable<Workspace["status"]>["phase"] = "Ready",
): Workspace {
  return {
    apiVersion: "tenancy.kcp.io/v1alpha1",
    kind: "Workspace",
    metadata: {
      name,
      uid: uid(),
      creationTimestamp: ts(Math.floor(Math.random() * 60 + 1)),
    },
    spec: { type: { name: type, path: "root" } },
    status: {
      phase,
      conditions:
        phase === "Ready"
          ? [{ type: "Ready", status: "True", reason: "Ready", lastTransitionTime: ts(1) }]
          : [{ type: "Ready", status: "False", reason: "Initializing", message: "Workspace is initializing", lastTransitionTime: ts(0) }],
    },
  };
}

function list<T>(kind: string, items: T[]): List<T> {
  return { apiVersion: "v1", kind, metadata: { resourceVersion: "1" }, items };
}

// ── Workspace tree ────────────────────────────────────────────────────────────
// Mirrors the provider/consumer model from the docs:
//
//   root (singleton)
//   ├── compute           (Organization) — API provider for compute services
//   │   ├── kaas          (Universal)    — KaaS APIExport lives here
//   │   └── networking    (Universal)    — networking APIExport lives here
//   ├── system            (Organization) — platform-wide system workspace
//   │   └── observability (Universal)    — observability APIExport lives here
//   └── consumers         (Organization) — tenant workspaces that bind APIs
//       ├── team-alpha    (Universal)    — binds kaas + observability
//       ├── team-beta     (Universal)    — binds kaas (Binding phase)
//       └── team-gamma    (Universal)    — no bindings yet (Initializing)

export const WORKSPACES: Record<string, Workspace[]> = {
  "root": [
    ws("compute",   "organization"),
    ws("system",    "organization"),
    ws("consumers", "organization"),
  ],
  "root:compute": [
    ws("kaas"),
    ws("networking"),
  ],
  "root:compute:kaas":       [],
  "root:compute:networking": [],
  "root:system": [
    ws("observability"),
  ],
  "root:system:observability": [],
  "root:consumers": [
    ws("team-alpha"),
    ws("team-beta"),
    ws("team-gamma", "universal", "Initializing"),
  ],
  "root:consumers:team-alpha": [],
  "root:consumers:team-beta":  [],
  "root:consumers:team-gamma": [],
};

// WorkspaceTypes — the built-in set kcp ships with (workspace-types battery)
export const WORKSPACE_TYPES: WorkspaceType[] = [
  {
    apiVersion: "tenancy.kcp.io/v1alpha1",
    kind: "WorkspaceType",
    metadata: { name: "universal", creationTimestamp: ts(90) },
    spec: {
      defaultChildWorkspaceType: { name: "universal", path: "root" },
    },
  },
  {
    apiVersion: "tenancy.kcp.io/v1alpha1",
    kind: "WorkspaceType",
    metadata: { name: "organization", creationTimestamp: ts(90) },
    spec: {
      defaultChildWorkspaceType: { name: "universal", path: "root" },
      limitAllowedChildren: { types: [{ name: "universal", path: "root" }, { name: "team", path: "root" }] },
    },
  },
  {
    apiVersion: "tenancy.kcp.io/v1alpha1",
    kind: "WorkspaceType",
    metadata: { name: "team", creationTimestamp: ts(90) },
    spec: {
      defaultChildWorkspaceType: { name: "universal", path: "root" },
      limitAllowedChildren: { types: [{ name: "universal", path: "root" }] },
    },
  },
];

// ── APIExports ────────────────────────────────────────────────────────────────
// Each export uses the v1alpha2 `spec.resources[]` shape from the docs, with
// APIResourceSchema names following the `<prefix>.<plural>.<group>` convention.

// root:compute:kaas — exports clusters and nodepools (KaaS provider)
const kaasExport: APIExport = {
  apiVersion: "apis.kcp.io/v1alpha2",
  kind: "APIExport",
  metadata: {
    name: "kaas.compute.example.com",
    uid: uid(),
    creationTimestamp: ts(45),
  },
  spec: {
    resources: [
      {
        name: "clusters",
        group: "compute.example.com",
        schema: "v250101.clusters.compute.example.com",
        storage: { crd: {} },
      },
      {
        name: "nodepools",
        group: "compute.example.com",
        schema: "v250101.nodepools.compute.example.com",
        storage: { crd: {} },
      },
    ],
    // The KaaS controller needs to read ConfigMaps and Secrets in consumer
    // workspaces to inject kubeconfig credentials. Permission claims let
    // consumers grant that access explicitly (see docs: Permission Claims).
    permissionClaims: [
      { group: "",                       resource: "secrets",      verbs: ["get", "list", "watch"] },
      { group: "",                       resource: "configmaps",   verbs: ["get", "list", "watch"] },
      { group: "rbac.authorization.k8s.io", resource: "clusterroles", verbs: ["get", "list", "watch", "create", "update"] },
      { group: "rbac.authorization.k8s.io", resource: "clusterrolebindings", verbs: ["get", "list", "watch", "create", "update"] },
    ],
  },
  status: {
    // identityHash is auto-generated by kcp when no spec.identity is given
    identityHash: "3a9f1c2d4b5e6f7a8b9c0d1e2f3a4b5c",
    conditions: [
      { type: "IdentityValid",             status: "True", reason: "IdentityValid",             lastTransitionTime: ts(45) },
      { type: "VirtualWorkspaceURLsReady", status: "True", reason: "VirtualWorkspaceURLsReady", lastTransitionTime: ts(45) },
    ],
    // Virtual workspace URL format from the docs
    virtualWorkspaces: [
      { url: "https://kcp.example.com/services/apiexport/root:compute:kaas/kaas.compute.example.com" },
    ],
  },
};

// root:compute:networking — exports VPCs and subnets
const networkingExport: APIExport = {
  apiVersion: "apis.kcp.io/v1alpha2",
  kind: "APIExport",
  metadata: {
    name: "networking.compute.example.com",
    uid: uid(),
    creationTimestamp: ts(30),
  },
  spec: {
    resources: [
      {
        name: "vpcs",
        group: "networking.example.com",
        schema: "v250201.vpcs.networking.example.com",
        storage: { crd: {} },
      },
      {
        name: "subnets",
        group: "networking.example.com",
        schema: "v250201.subnets.networking.example.com",
        storage: { crd: {} },
      },
    ],
    permissionClaims: [
      { group: "", resource: "configmaps", verbs: ["get", "list", "watch", "create", "update"] },
    ],
  },
  status: {
    identityHash: "7b2e5f8a1c4d6e9f0a3b6c9d2e5f8a1b",
    conditions: [
      { type: "IdentityValid",             status: "True", reason: "IdentityValid",             lastTransitionTime: ts(30) },
      { type: "VirtualWorkspaceURLsReady", status: "True", reason: "VirtualWorkspaceURLsReady", lastTransitionTime: ts(30) },
    ],
    virtualWorkspaces: [
      { url: "https://kcp.example.com/services/apiexport/root:compute:networking/networking.compute.example.com" },
    ],
  },
};

// root:system:observability — exports MetricsSources and AlertPolicies.
// Identity condition is False here to showcase a degraded export in the UI.
const observabilityExport: APIExport = {
  apiVersion: "apis.kcp.io/v1alpha2",
  kind: "APIExport",
  metadata: {
    name: "observability.system.example.com",
    uid: uid(),
    creationTimestamp: ts(15),
  },
  spec: {
    resources: [
      {
        name: "metricssources",
        group: "observability.example.com",
        schema: "v250301.metricssources.observability.example.com",
        storage: { crd: {} },
      },
      {
        name: "alertpolicies",
        group: "observability.example.com",
        schema: "v250301.alertpolicies.observability.example.com",
        storage: { crd: {} },
      },
    ],
    permissionClaims: [
      { group: "", resource: "configmaps", verbs: ["get", "list", "watch", "create", "update"] },
      { group: "", resource: "secrets",    verbs: ["get", "list"] },
    ],
  },
  status: {
    // No identityHash yet — identity secret not yet reconciled
    conditions: [
      {
        type: "IdentityValid",
        status: "False",
        reason: "IdentitySecretNotFound",
        message: "Secret observability.system.example.com not found in kcp-system namespace",
        lastTransitionTime: ts(1),
      },
      {
        type: "VirtualWorkspaceURLsReady",
        status: "False",
        reason: "IdentityNotValid",
        message: "Waiting for identity to be valid before provisioning virtual workspace URLs",
        lastTransitionTime: ts(1),
      },
    ],
  },
};

export const API_EXPORTS: Record<string, APIExport[]> = {
  "root:compute:kaas":         [kaasExport],
  "root:compute:networking":   [networkingExport],
  "root:system:observability": [observabilityExport],
};

// ── APIBindings ───────────────────────────────────────────────────────────────
// team-alpha: fully bound to kaas + networking, with permission claims accepted
// team-beta:  still Binding kaas (schema reconciliation pending)
// team-gamma: empty (Initializing workspace)

export const API_BINDINGS: Record<string, APIBinding[]> = {
  "root:consumers:team-alpha": [
    {
      apiVersion: "apis.kcp.io/v1alpha2",
      kind: "APIBinding",
      metadata: { name: "kaas.compute.example.com", uid: uid(), creationTimestamp: ts(40) },
      spec: {
        reference: { export: { path: "root:compute:kaas", name: "kaas.compute.example.com" } },
        // Consumer explicitly accepts each permission claim from the export
        // (see docs: "Permission claims must be accepted by the user explicitly")
        permissionClaims: [
          { group: "",                           resource: "secrets",             verbs: ["get", "list", "watch"],                          state: "Accepted", selector: { matchAll: true } },
          { group: "",                           resource: "configmaps",          verbs: ["get", "list", "watch"],                          state: "Accepted", selector: { matchAll: true } },
          { group: "rbac.authorization.k8s.io", resource: "clusterroles",        verbs: ["get", "list", "watch", "create", "update"],       state: "Accepted", selector: { matchAll: true } },
          { group: "rbac.authorization.k8s.io", resource: "clusterrolebindings", verbs: ["get", "list", "watch", "create", "update"],       state: "Rejected", selector: { matchAll: true } },
        ],
      },
      status: {
        phase: "Bound",
        boundResources: [
          {
            group: "compute.example.com",
            resource: "clusters",
            schema: { name: "v250101.clusters.compute.example.com", identityHash: "3a9f1c2d4b5e6f7a8b9c0d1e2f3a4b5c" },
            storageVersions: ["v1alpha1"],
          },
          {
            group: "compute.example.com",
            resource: "nodepools",
            schema: { name: "v250101.nodepools.compute.example.com", identityHash: "3a9f1c2d4b5e6f7a8b9c0d1e2f3a4b5c" },
            storageVersions: ["v1alpha1"],
          },
        ],
        conditions: [
          { type: "Ready",                   status: "True",  reason: "Ready",                   lastTransitionTime: ts(40) },
          { type: "APIExportValid",           status: "True",  reason: "Valid",                   lastTransitionTime: ts(40) },
          { type: "InitialBindingCompleted",  status: "True",  reason: "InitialBindingCompleted", lastTransitionTime: ts(40) },
          { type: "BindingUpToDate",          status: "True",  reason: "BindingUpToDate",          lastTransitionTime: ts(40) },
          { type: "PermissionClaimsValid",    status: "True",  reason: "Valid",                   lastTransitionTime: ts(40) },
          { type: "PermissionClaimsApplied",  status: "True",  reason: "Applied",                 lastTransitionTime: ts(40) },
        ],
      },
    },
    {
      apiVersion: "apis.kcp.io/v1alpha2",
      kind: "APIBinding",
      metadata: { name: "networking.compute.example.com", uid: uid(), creationTimestamp: ts(25) },
      spec: {
        reference: { export: { path: "root:compute:networking", name: "networking.compute.example.com" } },
        permissionClaims: [
          { group: "", resource: "configmaps", verbs: ["get", "list", "watch", "create", "update"], state: "Accepted", selector: { matchAll: true } },
        ],
      },
      status: {
        phase: "Bound",
        boundResources: [
          {
            group: "networking.example.com",
            resource: "vpcs",
            schema: { name: "v250201.vpcs.networking.example.com", identityHash: "7b2e5f8a1c4d6e9f0a3b6c9d2e5f8a1b" },
            storageVersions: ["v1alpha1"],
          },
          {
            group: "networking.example.com",
            resource: "subnets",
            schema: { name: "v250201.subnets.networking.example.com", identityHash: "7b2e5f8a1c4d6e9f0a3b6c9d2e5f8a1b" },
            storageVersions: ["v1alpha1"],
          },
        ],
        conditions: [
          { type: "Ready",                   status: "True",  reason: "Ready",                   lastTransitionTime: ts(25) },
          { type: "APIExportValid",           status: "True",  reason: "Valid",                   lastTransitionTime: ts(25) },
          { type: "InitialBindingCompleted",  status: "True",  reason: "InitialBindingCompleted", lastTransitionTime: ts(25) },
          { type: "BindingUpToDate",          status: "True",  reason: "BindingUpToDate",          lastTransitionTime: ts(25) },
          { type: "PermissionClaimsValid",    status: "True",  reason: "Valid",                   lastTransitionTime: ts(25) },
          { type: "PermissionClaimsApplied",  status: "True",  reason: "Applied",                 lastTransitionTime: ts(25) },
        ],
      },
    },
  ],

  // team-beta bound kaas recently — still reconciling
  "root:consumers:team-beta": [
    {
      apiVersion: "apis.kcp.io/v1alpha2",
      kind: "APIBinding",
      metadata: { name: "kaas.compute.example.com", uid: uid(), creationTimestamp: ts(2) },
      spec: {
        reference: { export: { path: "root:compute:kaas", name: "kaas.compute.example.com" } },
        permissionClaims: [
          { group: "", resource: "secrets",    verbs: ["get", "list", "watch"], state: "Accepted", selector: { matchAll: true } },
          { group: "", resource: "configmaps", verbs: ["get", "list", "watch"], state: "Accepted", selector: { matchAll: true } },
          { group: "rbac.authorization.k8s.io", resource: "clusterroles",        verbs: ["get", "list", "watch", "create", "update"], state: "Rejected", selector: { matchAll: true } },
          { group: "rbac.authorization.k8s.io", resource: "clusterrolebindings", verbs: ["get", "list", "watch", "create", "update"], state: "Rejected", selector: { matchAll: true } },
        ],
      },
      status: {
        phase: "Binding",
        boundResources: [],
        conditions: [
          { type: "APIExportValid",           status: "True",  reason: "Valid",   lastTransitionTime: ts(2) },
          { type: "InitialBindingCompleted",  status: "False", reason: "Pending", message: "Waiting for APIResourceSchema to be reconciled on the shard", lastTransitionTime: ts(2) },
          { type: "BindingUpToDate",          status: "False", reason: "Pending", lastTransitionTime: ts(2) },
          { type: "PermissionClaimsValid",    status: "True",  reason: "Valid",   lastTransitionTime: ts(2) },
          { type: "PermissionClaimsApplied",  status: "False", reason: "Pending", lastTransitionTime: ts(2) },
        ],
      },
    },
  ],

  // team-gamma: workspace is still Initializing, no bindings yet
  "root:consumers:team-gamma": [],
};

// ── Discovery ─────────────────────────────────────────────────────────────────
// Only APIs that kcp actually includes per the docs (built-in.md).
// Workload APIs (Pods, Deployments, Services, Nodes, PVs …) are intentionally
// absent — they live on downstream synced clusters, not in kcp workspaces.

export const CORE_RESOURCES = {
  groupVersion: "v1",
  resources: [
    { name: "configmaps",      kind: "ConfigMap",      namespaced: true,  verbs: ["create","delete","get","list","patch","update","watch"] },
    { name: "events",          kind: "Event",          namespaced: true,  verbs: ["create","get","list","patch","update","watch"] },
    { name: "namespaces",      kind: "Namespace",      namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
    { name: "resourcequotas",  kind: "ResourceQuota",  namespaced: true,  verbs: ["create","delete","get","list","patch","update","watch"] },
    { name: "secrets",         kind: "Secret",         namespaced: true,  verbs: ["create","delete","get","list","patch","update","watch"] },
    { name: "serviceaccounts", kind: "ServiceAccount", namespaced: true,  verbs: ["create","delete","get","list","patch","update","watch"] },
  ],
};

export const API_GROUPS = {
  groups: [
    { name: "admissionregistration.k8s.io", preferredVersion: { groupVersion: "admissionregistration.k8s.io/v1", version: "v1" } },
    { name: "apiextensions.k8s.io",         preferredVersion: { groupVersion: "apiextensions.k8s.io/v1",         version: "v1" } },
    { name: "authorization.k8s.io",         preferredVersion: { groupVersion: "authorization.k8s.io/v1",         version: "v1" } },
    { name: "certificates.k8s.io",          preferredVersion: { groupVersion: "certificates.k8s.io/v1",          version: "v1" } },
    { name: "coordination.k8s.io",          preferredVersion: { groupVersion: "coordination.k8s.io/v1",          version: "v1" } },
    { name: "events.k8s.io",                preferredVersion: { groupVersion: "events.k8s.io/v1",                version: "v1" } },
    { name: "rbac.authorization.k8s.io",    preferredVersion: { groupVersion: "rbac.authorization.k8s.io/v1",    version: "v1" } },
    { name: "tenancy.kcp.io",               preferredVersion: { groupVersion: "tenancy.kcp.io/v1alpha1",         version: "v1alpha1" } },
    { name: "apis.kcp.io",                  preferredVersion: { groupVersion: "apis.kcp.io/v1alpha2",            version: "v1alpha2" } },
    { name: "topology.kcp.io",              preferredVersion: { groupVersion: "topology.kcp.io/v1alpha1",        version: "v1alpha1" } },
    // Bound custom APIs — only present in workspaces that have the binding
    { name: "compute.example.com",          preferredVersion: { groupVersion: "compute.example.com/v1alpha1",    version: "v1alpha1" } },
    { name: "networking.example.com",       preferredVersion: { groupVersion: "networking.example.com/v1alpha1", version: "v1alpha1" } },
  ],
};

export const GROUP_RESOURCES: Record<string, {
  groupVersion: string;
  resources: { name: string; kind: string; namespaced: boolean; verbs: string[] }[];
}> = {
  "admissionregistration.k8s.io/v1": {
    groupVersion: "admissionregistration.k8s.io/v1",
    resources: [
      { name: "mutatingwebhookconfigurations",   kind: "MutatingWebhookConfiguration",   namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
      { name: "validatingwebhookconfigurations", kind: "ValidatingWebhookConfiguration", namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
      { name: "validatingadmissionpolicies",     kind: "ValidatingAdmissionPolicy",      namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
    ],
  },
  "apiextensions.k8s.io/v1": {
    groupVersion: "apiextensions.k8s.io/v1",
    resources: [
      { name: "customresourcedefinitions", kind: "CustomResourceDefinition", namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
    ],
  },
  "certificates.k8s.io/v1": {
    groupVersion: "certificates.k8s.io/v1",
    resources: [
      { name: "certificatesigningrequests", kind: "CertificateSigningRequest", namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
    ],
  },
  "coordination.k8s.io/v1": {
    groupVersion: "coordination.k8s.io/v1",
    resources: [
      { name: "leases", kind: "Lease", namespaced: true, verbs: ["create","delete","get","list","patch","update","watch"] },
    ],
  },
  "rbac.authorization.k8s.io/v1": {
    groupVersion: "rbac.authorization.k8s.io/v1",
    resources: [
      { name: "clusterroles",        kind: "ClusterRole",        namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
      { name: "clusterrolebindings", kind: "ClusterRoleBinding", namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
      { name: "roles",               kind: "Role",               namespaced: true,  verbs: ["create","delete","get","list","patch","update","watch"] },
      { name: "rolebindings",        kind: "RoleBinding",        namespaced: true,  verbs: ["create","delete","get","list","patch","update","watch"] },
    ],
  },
  "tenancy.kcp.io/v1alpha1": {
    groupVersion: "tenancy.kcp.io/v1alpha1",
    resources: [
      { name: "workspaces",     kind: "Workspace",     namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
      { name: "workspacetypes", kind: "WorkspaceType", namespaced: false, verbs: ["get","list","watch"] },
    ],
  },
  "apis.kcp.io/v1alpha2": {
    groupVersion: "apis.kcp.io/v1alpha2",
    resources: [
      { name: "apiexports",            kind: "APIExport",            namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
      { name: "apibindings",           kind: "APIBinding",           namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
    ],
  },
  "apis.kcp.io/v1alpha1": {
    groupVersion: "apis.kcp.io/v1alpha1",
    resources: [
      { name: "apiresourceschemas",       kind: "APIResourceSchema",       namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
      { name: "apiexportendpointslices",  kind: "APIExportEndpointSlice",  namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
    ],
  },
  "topology.kcp.io/v1alpha1": {
    groupVersion: "topology.kcp.io/v1alpha1",
    resources: [
      { name: "partitions",    kind: "Partition",    namespaced: false, verbs: ["get","list","watch"] },
      { name: "partitionsets", kind: "PartitionSet", namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
    ],
  },
  // Bound custom APIs (present once APIBinding is Bound)
  "compute.example.com/v1alpha1": {
    groupVersion: "compute.example.com/v1alpha1",
    resources: [
      { name: "clusters",   kind: "Cluster",   namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
      { name: "nodepools",  kind: "NodePool",  namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
    ],
  },
  "networking.example.com/v1alpha1": {
    groupVersion: "networking.example.com/v1alpha1",
    resources: [
      { name: "vpcs",     kind: "VPC",    namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
      { name: "subnets",  kind: "Subnet", namespaced: false, verbs: ["create","delete","get","list","patch","update","watch"] },
    ],
  },
};

// ── Managed fields helpers ────────────────────────────────────────────────────
// Added only to bound CR instances (clusters, nodepools, vpcs, subnets) —
// the resources where a demo visitor would realistically encounter this noisy
// field and want to toggle it off.

function mf(manager: string, operation: "Apply" | "Update", time: string, fields: Record<string, unknown>) {
  return { manager, operation, apiVersion: "v1", time, fieldsType: "FieldsV1", fieldsV1: fields };
}

const MF_KUBECTL_APPLY = mf(
  "kubectl-apply", "Apply", ts(45),
  { "f:metadata": { "f:annotations": { ".": {}, "f:kubectl.kubernetes.io/last-applied-configuration": {} } }, "f:spec": { ".": {}, "f:resources": {} } },
);

// ── Sample objects per resource ───────────────────────────────────────────────
// Only kcp-native resource types — no workload objects.
export const OBJECTS: Record<string, {
  name: string;
  namespace?: string;
  creationTimestamp: string;
  [k: string]: unknown;
}[]> = {
  // core/v1
  "namespaces": [
    { name: "default",    creationTimestamp: ts(90), status: { phase: "Active" } },
    { name: "kcp-system", creationTimestamp: ts(90), status: { phase: "Active" } },
  ],
  "configmaps": [
    { name: "kcp-root-ca.crt",   namespace: "kcp-system", creationTimestamp: ts(90), data: { "ca.crt": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----" } },
    { name: "workspace-config",  namespace: "default",    creationTimestamp: ts(40), data: { "config.yaml": "apiServer: https://kcp.example.com\nlogLevel: info" } },
  ],
  "secrets": [
    { name: "kaas.compute.example.com",       namespace: "kcp-system", creationTimestamp: ts(45), type: "Opaque" },
    { name: "networking.compute.example.com", namespace: "kcp-system", creationTimestamp: ts(30), type: "Opaque" },
  ],
  "serviceaccounts": [
    { name: "default",         namespace: "default",    creationTimestamp: ts(90) },
    { name: "kaas-controller", namespace: "kcp-system", creationTimestamp: ts(45) },
  ],
  // rbac
  "clusterroles": [
    { name: "cluster-admin",                                                                    creationTimestamp: ts(90), rules: [{ apiGroups: ["*"],                resources: ["*"],                     verbs: ["*"] }] },
    { name: "system:kcp:apiexport:kaas.compute.example.com:maximal-permission-policy",         creationTimestamp: ts(45), rules: [{ apiGroups: ["compute.example.com"], resources: ["clusters", "nodepools"], verbs: ["*"] }] },
    { name: "compute.example.com:access-content",                                              creationTimestamp: ts(45), rules: [{ apiGroups: ["apis.kcp.io"],        resources: ["apiexports/content"],    resourceNames: ["kaas.compute.example.com"], verbs: ["*"] }] },
    { name: "view",                                                                             creationTimestamp: ts(90), rules: [{ apiGroups: ["*"],                resources: ["*"],                     verbs: ["get", "list", "watch"] }] },
    { name: "edit",                                                                             creationTimestamp: ts(90), rules: [{ apiGroups: ["*"],                resources: ["*"],                     verbs: ["get", "list", "watch", "create", "update", "patch", "delete"] }] },
  ],
  "clusterrolebindings": [
    { name: "workspace-admin",                                                                  creationTimestamp: ts(90), roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cluster-admin" },                                                                              subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "User",  name: "system:admin" }] },
    { name: "system:kcp:authenticated:apiexport:kaas:maximal-permission-policy",               creationTimestamp: ts(45), roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "system:kcp:apiexport:kaas.compute.example.com:maximal-permission-policy" },                   subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: "apis.kcp.io:binding:system:authenticated" }] },
  ],
  // tenancy
  "workspaces": [
    { name: "compute",   creationTimestamp: ts(90), spec: { type: { name: "organization", path: "root" } }, status: { phase: "Ready", url: "https://kcp.example.com/clusters/root:compute" } },
    { name: "system",    creationTimestamp: ts(90), spec: { type: { name: "organization", path: "root" } }, status: { phase: "Ready", url: "https://kcp.example.com/clusters/root:system" } },
    { name: "consumers", creationTimestamp: ts(90), spec: { type: { name: "organization", path: "root" } }, status: { phase: "Ready", url: "https://kcp.example.com/clusters/root:consumers" } },
  ],
  "workspacetypes": [
    { name: "universal",    creationTimestamp: ts(90) },
    { name: "organization", creationTimestamp: ts(90) },
    { name: "team",         creationTimestamp: ts(90) },
  ],
  // apis.kcp.io
  "apiexports": [
    { name: "kaas.compute.example.com",         creationTimestamp: ts(45) },
    { name: "networking.compute.example.com",   creationTimestamp: ts(30) },
    { name: "observability.system.example.com", creationTimestamp: ts(15) },
  ],
  "apibindings": [
    { name: "kaas.compute.example.com",       creationTimestamp: ts(40) },
    { name: "networking.compute.example.com", creationTimestamp: ts(25) },
  ],
  "apiresourceschemas": [
    { name: "v250101.clusters.compute.example.com",             creationTimestamp: ts(45) },
    { name: "v250101.nodepools.compute.example.com",            creationTimestamp: ts(45) },
    { name: "v250201.vpcs.networking.example.com",              creationTimestamp: ts(30) },
    { name: "v250201.subnets.networking.example.com",           creationTimestamp: ts(30) },
    { name: "v250301.metricssources.observability.example.com", creationTimestamp: ts(15) },
    { name: "v250301.alertpolicies.observability.example.com",  creationTimestamp: ts(15) },
  ],
  // Bound custom resources — CR instances created by end-users; managedFields
  // added here because these are the objects where the toggle matters most.
  "clusters": [
    {
      name: "prod-eu-west", creationTimestamp: ts(10),
      spec: { region: "eu-west-1", version: "1.32" },
      status: { phase: "Running", nodeCount: 6 },
      managedFields: [
        MF_KUBECTL_APPLY,
        mf("kaas-controller", "Update", ts(9), { "f:status": { ".": {}, "f:phase": {}, "f:nodeCount": {} } }),
      ],
    },
    {
      name: "staging-us-east", creationTimestamp: ts(3),
      spec: { region: "us-east-1", version: "1.32" },
      status: { phase: "Provisioning", nodeCount: 0 },
      managedFields: [
        MF_KUBECTL_APPLY,
        mf("kaas-controller", "Update", ts(2), { "f:status": { ".": {}, "f:phase": {}, "f:nodeCount": {} } }),
      ],
    },
  ],
  "nodepools": [
    {
      name: "default-pool", creationTimestamp: ts(10),
      spec: { replicas: 3, instanceType: "m5.xlarge" },
      status: { readyNodes: 3 },
      managedFields: [
        MF_KUBECTL_APPLY,
        mf("kaas-nodepool-controller", "Update", ts(9), { "f:status": { ".": {}, "f:readyNodes": {} } }),
      ],
    },
    {
      name: "gpu-pool", creationTimestamp: ts(8),
      spec: { replicas: 1, instanceType: "g4dn.xlarge" },
      status: { readyNodes: 1 },
      managedFields: [
        MF_KUBECTL_APPLY,
        mf("kaas-nodepool-controller", "Update", ts(7), { "f:status": { ".": {}, "f:readyNodes": {} } }),
      ],
    },
  ],
  "vpcs": [
    {
      name: "main-vpc", creationTimestamp: ts(20),
      spec: { cidr: "10.0.0.0/16", region: "eu-west-1" },
      status: { phase: "Ready" },
      managedFields: [
        MF_KUBECTL_APPLY,
        mf("networking-controller", "Update", ts(19), { "f:status": { ".": {}, "f:phase": {} } }),
      ],
    },
  ],
  "subnets": [
    {
      name: "public-a", creationTimestamp: ts(20),
      spec: { cidr: "10.0.1.0/24", availabilityZone: "eu-west-1a" },
      status: { phase: "Ready" },
      managedFields: [
        MF_KUBECTL_APPLY,
        mf("networking-controller", "Update", ts(19), { "f:status": { ".": {}, "f:phase": {} } }),
      ],
    },
    {
      name: "private-a", creationTimestamp: ts(20),
      spec: { cidr: "10.0.2.0/24", availabilityZone: "eu-west-1a" },
      status: { phase: "Ready" },
      managedFields: [
        MF_KUBECTL_APPLY,
        mf("networking-controller", "Update", ts(19), { "f:status": { ".": {}, "f:phase": {} } }),
      ],
    },
  ],
};

export { list };
