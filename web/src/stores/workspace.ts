// Tracks the current workspace path context plus the sidebar tree's expansion
// state, shared across the app so the tree, breadcrumb, and resource views stay
// in sync.

import { defineStore } from "pinia";
import { ref, reactive, computed } from "vue";

export const ROOT = "root";

export const useWorkspaceStore = defineStore("workspace", () => {
  const current = ref<string>(ROOT);

  // Paths whose children are expanded in the sidebar tree.
  const expandedPaths = reactive(new Set<string>([ROOT]));

  // Bumped to ask the tree to reload (e.g. after create/delete).
  const treeReloadKey = ref(0);

  // Path segments for breadcrumbs, e.g. "root:org:team" -> ["root","org","team"].
  const segments = computed(() => current.value.split(":"));

  function setPath(path: string) {
    current.value = path || ROOT;
  }

  function expand(path: string) {
    expandedPaths.add(path);
  }

  function collapse(path: string) {
    expandedPaths.delete(path);
  }

  function toggle(path: string) {
    if (expandedPaths.has(path)) expandedPaths.delete(path);
    else expandedPaths.add(path);
  }

  // Collapse the whole tree back to just the root node open.
  function collapseAll() {
    expandedPaths.clear();
    expandedPaths.add(ROOT);
  }

  function isExpanded(path: string): boolean {
    return expandedPaths.has(path);
  }

  function reloadTree() {
    treeReloadKey.value++;
  }

  return {
    current,
    expandedPaths,
    treeReloadKey,
    segments,
    setPath,
    expand,
    collapse,
    collapseAll,
    toggle,
    isExpanded,
    reloadTree,
  };
});
