// Shared types and injection keys for the workspace sidebar tree.

import type { InjectionKey } from "vue";

export interface TreeNodeData {
  name: string; // short workspace name (last path segment)
  path: string; // full colon path, e.g. "root:org:team"
  phase?: string; // Workspace status.phase ("" / undefined for root)
  hasChildren: boolean; // known-to-have children (after load), optimistic before
  expanded: boolean;
  loaded: boolean; // children have been fetched at least once
  loading: boolean;
  children: TreeNodeData[];
}

export interface TreeHandlers {
  select: (path: string) => void;
  toggle: (node: TreeNodeData) => void;
  remove: (node: TreeNodeData) => void;
  currentPath: () => string;
}

export const TreeHandlersKey: InjectionKey<TreeHandlers> = Symbol("treeHandlers");
