// kcp resource operations used by the dashboard.

import { api, kcpUrl } from "./client";
import type { List, Workspace, WorkspaceType } from "../types/kcp";

const TENANCY = "apis/tenancy.kcp.io/v1alpha1";

// List WorkspaceTypes visible in the given workspace (used to populate the
// "create workspace" type picker).
export function listWorkspaceTypes(
  clusterPath: string,
): Promise<List<WorkspaceType>> {
  return api.get<List<WorkspaceType>>(
    kcpUrl(clusterPath, `${TENANCY}/workspacetypes`),
  );
}

// List child workspaces of the given workspace path.
export function listWorkspaces(clusterPath: string): Promise<List<Workspace>> {
  return api.get<List<Workspace>>(kcpUrl(clusterPath, `${TENANCY}/workspaces`));
}

export function getWorkspace(
  clusterPath: string,
  name: string,
): Promise<Workspace> {
  return api.get<Workspace>(
    kcpUrl(clusterPath, `${TENANCY}/workspaces/${name}`),
  );
}

export function createWorkspace(
  clusterPath: string,
  name: string,
  type: { name: string; path?: string },
): Promise<Workspace> {
  const body: Workspace = {
    apiVersion: "tenancy.kcp.io/v1alpha1",
    kind: "Workspace",
    metadata: { name },
    spec: { type },
  };
  return api.post<Workspace>(kcpUrl(clusterPath, `${TENANCY}/workspaces`), body);
}

export function deleteWorkspace(
  clusterPath: string,
  name: string,
): Promise<unknown> {
  return api.delete(kcpUrl(clusterPath, `${TENANCY}/workspaces/${name}`));
}

// The child workspace path derived from a parent path and workspace name.
export function childPath(parent: string, name: string): string {
  return parent ? `${parent}:${name}` : name;
}
