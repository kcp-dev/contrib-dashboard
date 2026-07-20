<script setup lang="ts">
import { reactive, provide, onMounted, watch, ref } from "vue";
import { storeToRefs } from "pinia";
import { useWorkspaceStore, ROOT } from "../stores/workspace";
import {
  listWorkspaces,
  listWorkspaceTypes,
  createWorkspace,
  deleteWorkspace,
  childPath,
} from "../api/kcp";
import { ApiError } from "../api/client";
import TreeNode from "./TreeNode.vue";
import { TreeHandlersKey, type TreeNodeData } from "./tree";

const store = useWorkspaceStore();
const { current, treeReloadKey } = storeToRefs(store);

const error = ref<string | null>(null);
const rootLoading = ref(false);

// --- create form state (targets the currently-selected workspace) ---
const newName = ref("");
const newType = ref("universal");
const types = ref<string[]>([]);
const creating = ref(false);

function newNode(name: string, path: string, phase?: string): TreeNodeData {
  return {
    name,
    path,
    phase,
    hasChildren: false,
    expanded: store.isExpanded(path),
    loaded: false,
    loading: false,
    children: [],
  };
}

const root = reactive<TreeNodeData>(newNode(ROOT, ROOT));

async function loadInto(node: TreeNodeData) {
  node.loading = true;
  try {
    const list = await listWorkspaces(node.path);
    const items = list.items ?? [];
    node.children = items
      .filter((w) => !w.metadata.deletionTimestamp)
      .map((w) =>
        newNode(
          w.metadata.name,
          childPath(node.path, w.metadata.name),
          w.status?.phase,
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    node.hasChildren = node.children.length > 0;
    node.loaded = true;
    error.value = null;

    for (const child of node.children) {
      if (child.expanded) await loadInto(child);
    }
  } catch (e) {
    node.children = [];
    node.loaded = true;
    error.value = (e as Error).message;
  } finally {
    node.loading = false;
  }
}

async function rebuild() {
  rootLoading.value = true;
  root.expanded = true;
  store.expand(ROOT);
  await loadInto(root);
  rootLoading.value = false;
}

const expandingAll = ref(false);

// Recursively load and expand every node in the tree.
async function expandNode(node: TreeNodeData) {
  store.expand(node.path);
  node.expanded = true;
  if (!node.loaded) await loadInto(node);
  for (const child of node.children) await expandNode(child);
}

async function expandAll() {
  expandingAll.value = true;
  try {
    await expandNode(root);
  } finally {
    expandingAll.value = false;
  }
}

function collapseAll() {
  store.collapseAll();
  rebuild();
}

// Types available for children of the selected workspace. Best-effort.
async function loadTypes() {
  try {
    const list = await listWorkspaceTypes(current.value);
    const names = (list.items ?? [])
      .map((t) => t.metadata.name)
      .sort((a, b) => a.localeCompare(b));
    types.value = names;
    if (names.length && !names.includes(newType.value)) {
      newType.value = names.includes("universal") ? "universal" : names[0];
    }
  } catch {
    types.value = [];
  }
}

async function create() {
  if (!newName.value) return;
  creating.value = true;
  error.value = null;
  try {
    await createWorkspace(current.value, newName.value, { name: newType.value });
    newName.value = "";
    store.expand(current.value); // reveal the new child
    store.reloadTree();
    // Refresh a couple of times so the phase dot settles to Ready.
    setTimeout(() => store.reloadTree(), 2000);
    setTimeout(() => store.reloadTree(), 5000);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    creating.value = false;
  }
}

provide(TreeHandlersKey, {
  select: (path: string) => store.setPath(path),
  toggle: async (node: TreeNodeData) => {
    store.toggle(node.path);
    node.expanded = store.isExpanded(node.path);
    if (node.expanded && !node.loaded) await loadInto(node);
  },
  remove: async (node: TreeNodeData) => {
    const parent = node.path.split(":").slice(0, -1).join(":");
    if (!parent) return; // never delete the root
    if (!confirm(`Delete workspace "${node.name}"?`)) return;
    try {
      await deleteWorkspace(parent, node.name);
      // If we deleted the selected workspace (or an ancestor), move up.
      if (current.value === node.path || current.value.startsWith(node.path + ":")) {
        store.setPath(parent);
      }
      store.reloadTree();
      setTimeout(() => store.reloadTree(), 2000);
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : String(e);
    }
  },
  currentPath: () => current.value,
});

onMounted(() => {
  rebuild();
  loadTypes();
});
watch(treeReloadKey, rebuild);
watch(current, loadTypes); // create-form types follow the selected workspace
</script>

<template>
  <aside class="tree">
    <div class="tree-head">
      <span class="tree-title">Workspaces</span>
      <div class="tree-actions">
        <button
          class="tree-btn"
          @click="expandAll"
          :disabled="expandingAll"
          title="expand all"
        >
          <span :class="{ spin: expandingAll }">⊞</span>
        </button>
        <button class="tree-btn" @click="collapseAll" title="collapse all">
          ⊟
        </button>
        <button class="tree-btn" @click="rebuild" title="refresh">
          <span :class="{ spin: rootLoading }">↻</span>
        </button>
      </div>
    </div>

    <div class="tree-body">
      <TreeNode :node="root" :depth="0" />
    </div>

    <form class="create" @submit.prevent="create">
      <div class="create-label">
        New workspace in <code>{{ current }}</code>
      </div>
      <input v-model="newName" placeholder="name" />
      <div class="create-row">
        <select v-if="types.length" v-model="newType" title="WorkspaceType">
          <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
        </select>
        <input v-else v-model="newType" placeholder="type" />
        <button type="submit" :disabled="creating || !newName">
          {{ creating ? "…" : "Create" }}
        </button>
      </div>
      <p v-if="error" class="tree-error" :title="error">{{ error }}</p>
    </form>
  </aside>
</template>

<style scoped>
.tree {
  width: 260px;
  flex: none;
  background: #2f3d44;
  color: #cfd8dc;
  border-right: 1px solid #1c262b;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 56px);
}
.tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid #1c262b;
}
.tree-title {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #90a4ae;
  font-weight: 700;
}
.tree-actions {
  display: flex;
  gap: 0.15rem;
}
.tree-btn {
  background: none;
  border: none;
  color: #90a4ae;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0.1rem 0.25rem;
  border-radius: 4px;
}
.tree-btn:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}
.tree-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.spin {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.tree-body {
  padding: 0.5rem 0.4rem;
  overflow-y: auto;
  flex: 1;
}
.create {
  border-top: 1px solid #1c262b;
  padding: 0.75rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  background: #29353b;
}
.create-label {
  font-size: 0.72rem;
  color: #90a4ae;
}
.create-label code {
  background: #1c262b;
  color: #cfd8dc;
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
}
.create-row {
  display: flex;
  gap: 0.4rem;
}
.create input,
.create select {
  padding: 0.35rem 0.5rem;
  border: 1px solid #455a64;
  border-radius: 6px;
  background: #1c262b;
  color: #eceff1;
  font-size: 0.82rem;
  min-width: 0;
}
.create input {
  width: 100%;
}
.create select {
  flex: 1;
}
.create button {
  border: 1px solid #1565c0;
  background: #1565c0;
  color: #fff;
  border-radius: 6px;
  padding: 0.35rem 0.7rem;
  cursor: pointer;
  font-size: 0.82rem;
}
.create button:disabled {
  opacity: 0.5;
  cursor: default;
}
.tree-error {
  color: #ef9a9a;
  font-size: 0.75rem;
  margin: 0;
  word-break: break-word;
}
</style>
