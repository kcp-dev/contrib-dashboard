// Minimal TypeScript views of the kcp API kinds the dashboard touches. These
// mirror the Go types in staging/src/github.com/kcp-dev/sdk/apis. Only the
// fields the UI reads/writes are modelled; unknown fields are preserved by
// keeping objects loosely typed where needed.

export interface ObjectMeta {
  name: string;
  uid?: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  deletionTimestamp?: string;
}

export interface Condition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface List<T> {
  apiVersion: string;
  kind: string;
  metadata: { resourceVersion?: string };
  items: T[];
}

// tenancy.kcp.io/v1alpha1 Workspace
export type WorkspacePhase =
  | "Scheduling"
  | "Initializing"
  | "Ready"
  | "Unavailable"
  | "Inactive"
  | "Terminating"
  | "Deleting"
  | "";

export interface WorkspaceTypeReference {
  name: string;
  path?: string;
}

export interface Workspace {
  apiVersion: string;
  kind: "Workspace";
  metadata: ObjectMeta;
  spec: {
    type?: WorkspaceTypeReference;
    cluster?: string;
    URL?: string;
  };
  status?: {
    phase?: WorkspacePhase;
    conditions?: Condition[];
  };
}

// tenancy.kcp.io/v1alpha1 WorkspaceType (subset)
export interface WorkspaceType {
  apiVersion: string;
  kind: "WorkspaceType";
  metadata: ObjectMeta;
  spec?: {
    defaultChildWorkspaceType?: WorkspaceTypeReference;
    limitAllowedChildren?: { types?: WorkspaceTypeReference[] };
  };
}
