<script setup lang="ts">
import { reactive, provide, onMounted, onUnmounted, watch, ref, nextTick } from "vue";
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
import ConfirmDialog from "./ConfirmDialog.vue";
import { usePoller } from "../composables/usePoller";
import { TreeHandlersKey, type TreeNodeData } from "./tree";

const store = useWorkspaceStore();
const { current, treeReloadKey } = storeToRefs(store);

const error = ref<string | null>(null);
const rootLoading = ref(false);

// ── Modal state ───────────────────────────────────────────────────
const showModal = ref(false);
const newName = ref("");
const newType = ref("universal");
const types = ref<string[]>([]);
const creating = ref(false);
const createError = ref<string | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);

function openModal() {
  newName.value = "";
  createError.value = null;
  showModal.value = true;
  nextTick(() => nameInput.value?.focus());
}

function closeModal() {
  showModal.value = false;
  createError.value = null;
}

function dismissModal() {
  if (creating.value) return; // don't close mid-flight
  closeModal();
}

// ── Delete confirm dialog ─────────────────────────────────────────
const confirmNode   = ref<TreeNodeData | null>(null);
const deleting      = ref(false);

function askDelete(node: TreeNodeData) {
  confirmNode.value = node;
}

const treePollStatus = ref<"idle" | "polling" | "timeout">("idle");
let treePoller: ReturnType<typeof usePoller> | null = null;

async function pollTreeUntil(parentPath: string, done: (items: import("../types/kcp").Workspace[]) => boolean) {
  treePoller?.stop();
  treePoller = usePoller(
    async () => {
      const list = await listWorkspaces(parentPath);
      const items = (list.items ?? []).filter(w => !w.metadata.deletionTimestamp);
      // Rebuild on every tick so the tree stays live while we wait
      await rebuild();
      return items;
    },
    done,
    { interval: 2000, timeout: 30_000 },
  );
  await treePoller.poll();
  treePollStatus.value = treePoller.state.value;
  rebuild();
}

async function doDelete() {
  const node = confirmNode.value;
  if (!node) return;
  const parent = node.path.split(":").slice(0, -1).join(":");
  if (!parent) { confirmNode.value = null; return; }
  deleting.value = true;
  const deletedName = node.name;
  try {
    await deleteWorkspace(parent, node.name);
    if (current.value === node.path || current.value.startsWith(node.path + ":")) {
      store.setPath(parent);
    }
    confirmNode.value = null;
    treePollStatus.value = "polling";
    void pollTreeUntil(parent, items => !items.some(w => w.metadata.name === deletedName));
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    confirmNode.value = null;
  } finally {
    deleting.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") dismissModal();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

// ── Tree logic ────────────────────────────────────────────────────
function newNode(name: string, path: string, phase?: string): TreeNodeData {
  return { name, path, phase, hasChildren: false, expanded: store.isExpanded(path), loaded: false, loading: false, children: [] };
}

const root = reactive<TreeNodeData>(newNode(ROOT, ROOT));

// Probe a single node's children without expanding it — just sets
// hasChildren + loaded so the chevron decision is accurate on first render.
async function probe(node: TreeNodeData) {
  try {
    const sub = await listWorkspaces(node.path);
    const subItems = (sub.items ?? []).filter((w) => !w.metadata.deletionTimestamp);
    node.hasChildren = subItems.length > 0;
    node.loaded = true;
    // Pre-populate children list (without loading their subtrees) so that
    // if the user expands this node the rows appear instantly and we can
    // probe the next level in parallel.
    if (node.hasChildren && node.children.length === 0) {
      node.children = subItems
        .map((w) => newNode(w.metadata.name, childPath(node.path, w.metadata.name), w.status?.phase))
        .sort((a, b) => a.name.localeCompare(b.name));
      // Probe grandchildren in parallel so depth+2 chevrons are also accurate.
      await Promise.all(node.children.map(probe));
    }
  } catch {
    // Mark as loaded so we don't show a stale chevron indefinitely.
    // hasChildren stays false; the user can refresh to retry.
    node.loaded = true;
  }
}

async function loadInto(node: TreeNodeData) {
  node.loading = true;
  try {
    const list = await listWorkspaces(node.path);
    const items = list.items ?? [];
    node.children = items
      .filter((w) => !w.metadata.deletionTimestamp)
      .map((w) => newNode(w.metadata.name, childPath(node.path, w.metadata.name), w.status?.phase))
      .sort((a, b) => a.name.localeCompare(b.name));
    node.hasChildren = node.children.length > 0;
    node.loaded = true;
    error.value = null;

    // For each child: if it was already expanded reload it fully,
    // otherwise probe it (+ its children) so chevrons are accurate immediately.
    await Promise.all(node.children.map((child) =>
      child.expanded ? loadInto(child) : probe(child)
    ));
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

async function expandNode(node: TreeNodeData) {
  store.expand(node.path);
  node.expanded = true;
  if (!node.loaded) await loadInto(node);
  for (const child of node.children) await expandNode(child);
}

async function expandAll() {
  expandingAll.value = true;
  try { await expandNode(root); } finally { expandingAll.value = false; }
}

function collapseAll() { store.collapseAll(); rebuild(); }

async function loadTypes() {
  try {
    const list = await listWorkspaceTypes(current.value);
    const names = (list.items ?? []).map((t) => t.metadata.name).sort((a, b) => a.localeCompare(b));
    types.value = names;
    if (names.length && !names.includes(newType.value)) {
      newType.value = names.includes("universal") ? "universal" : names[0];
    }
  } catch { types.value = []; }
}

async function create() {
  if (!newName.value.trim()) return;
  creating.value = true;
  createError.value = null;
  try {
    const createdName = newName.value.trim();
    await createWorkspace(current.value, createdName, { name: newType.value });
    closeModal();
    store.expand(current.value);
    const parentPath = current.value;
    treePollStatus.value = "polling";
    void pollTreeUntil(parentPath, items => items.some(w => w.metadata.name === createdName && w.status?.phase === 'Ready'));
  } catch (e) {
    createError.value = e instanceof ApiError ? e.message : String(e);
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
    askDelete(node);
  },
  currentPath: () => current.value,
});

onMounted(() => { rebuild(); loadTypes(); });
onUnmounted(() => treePoller?.stop());
watch(treeReloadKey, rebuild);
watch(current, loadTypes);
</script>

<template>
  <aside class="tree">
    <!-- Header -->
    <div class="tree-head">
      <span class="tree-title">Workspaces</span>
      <div class="tree-actions">
        <!-- Expand all -->
        <button class="tree-btn" @click="expandAll" :disabled="expandingAll" title="Expand all">
          <svg :class="{ spin: expandingAll }" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6l5 5 5-5"/>
          </svg>
        </button>
        <!-- Collapse all -->
        <button class="tree-btn" @click="collapseAll" title="Collapse all">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 10l5-5 5 5"/>
          </svg>
        </button>
        <!-- Refresh -->
        <button
          class="tree-btn" :class="{ 'tree-btn--warn': treePollStatus === 'timeout' }"
          @click="treePollStatus = 'idle'; treePoller?.stop(); rebuild()"
          :title="treePollStatus === 'timeout' ? 'Sync timed out — click to retry' : treePollStatus === 'polling' ? 'Syncing…' : 'Refresh'"
        >
          <!-- polling -->
          <svg v-if="treePollStatus === 'polling'" class="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          <!-- timeout warning -->
          <svg v-else-if="treePollStatus === 'timeout'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <!-- idle -->
          <svg v-else :class="{ spin: rootLoading }" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
        <div class="divider"></div>
        <!-- New workspace -->
        <button class="tree-btn add-btn" @click="openModal" title="New workspace">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M8 3v10M3 8h10"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Tree -->
    <div class="tree-body">
      <TreeNode :node="root" :depth="0" />
      <p v-if="error" class="tree-error">{{ error }}</p>
    </div>

    <!-- New Workspace Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showModal" class="modal-backdrop" @click.self="dismissModal">
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">

            <div class="modal-header">
              <div class="modal-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M8 1v14M1 8h14"/>
                </svg>
              </div>
              <div>
                <h2 id="modal-title" class="modal-title">New workspace</h2>
                <p class="modal-subtitle">
                  Will be created inside
                  <span class="modal-ctx">{{ current }}</span>
                </p>
              </div>
              <button class="modal-close" @click="dismissModal" title="Close">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M1 1l12 12M13 1L1 13"/>
                </svg>
              </button>
            </div>

            <form class="modal-body" @submit.prevent="create">
              <div class="field">
                <label class="field-label" for="ws-name">Name</label>
                <input
                  id="ws-name"
                  ref="nameInput"
                  class="field-input"
                  v-model="newName"
                  placeholder="e.g. staging"
                  autocomplete="off"
                  spellcheck="false"
                  :disabled="creating"
                />
              </div>

              <div class="field">
                <label class="field-label" for="ws-type">Type</label>
                <select v-if="types.length" id="ws-type" class="field-input field-select" v-model="newType" :disabled="creating">
                  <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
                </select>
                <input v-else id="ws-type" class="field-input" v-model="newType" placeholder="universal" :disabled="creating" />
                <p class="field-hint">Defines which resource APIs are available in this workspace.</p>
              </div>

              <div v-if="createError" class="modal-error">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="7" cy="7" r="6"/><path d="M7 4v3.5M7 10h.01"/></svg>
                {{ createError }}
              </div>

              <div class="modal-footer">
                <button type="button" class="btn-cancel" @click="dismissModal" :disabled="creating">Cancel</button>
                <button type="submit" class="btn-create" :disabled="creating || !newName.trim()">
                  <span v-if="creating" class="spin">↻</span>
                  {{ creating ? "Creating…" : "Create workspace" }}
                </button>
              </div>
            </form>

          </div>
        </div>
      </Transition>
    </Teleport>

    <ConfirmDialog
      v-if="confirmNode"
      :title="`Delete workspace '${confirmNode.name}'?`"
      message="This will permanently delete the workspace and all its contents. This action cannot be undone."
      confirm-label="Delete workspace"
      :busy="deleting"
      @confirm="doDelete"
      @cancel="confirmNode = null"
    />
  </aside>
</template>

<style scoped>
/* ── Sidebar shell ── */
.tree {
  width: 260px;
  flex: none;
  background: #1a2332;
  color: #cbd5e1;
  border-right: 1px solid rgba(255,255,255,0.06);
  display: flex;
  flex-direction: column;
  height: calc(100vh - 54px);
  position: sticky;
  top: 54px;
}

/* ── Header ── */
.tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.5rem 0 0.9rem;
  height: 40px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex: none;
}
.tree-title {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #64748b;
  font-weight: 700;
}
.tree-actions {
  display: flex;
  align-items: center;
  gap: 0.05rem;
}
.divider {
  width: 1px;
  height: 14px;
  background: rgba(255,255,255,0.1);
  margin: 0 0.2rem;
}
.tree-btn {
  background: none;
  border: none;
  color: #7c8fa3;
  cursor: pointer;
  font-size: 0.95rem;
  line-height: 1;
  padding: 0.22rem 0.3rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.1s, background 0.1s;
}
.tree-btn:hover:not(:disabled) {
  color: #e2e8f0;
  background: rgba(255,255,255,0.08);
}
.tree-btn:disabled { opacity: 0.35; cursor: default; }
.tree-btn--warn { color: #f59e0b !important; }
.tree-btn--warn:hover:not(:disabled) { color: #fbbf24 !important; background: rgba(245,158,11,0.15); }

.add-btn { color: #818cf8; }
.add-btn:hover:not(:disabled) {
  color: #fff;
  background: rgba(99,102,241,0.25) !important;
}

/* ── Tree body ── */
.tree-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.4rem 0.35rem;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.08) transparent;
}
.tree-error {
  font-size: 0.72rem;
  color: #fca5a5;
  background: rgba(239,68,68,0.1);
  border-radius: 4px;
  padding: 0.3rem 0.5rem;
  margin: 0.4rem 0.2rem 0;
}

@keyframes spin { to { transform: rotate(360deg); } }
.spin {
  display: inline-block;
  animation: spin 0.7s linear infinite;
  transform-origin: center;
  transform-box: fill-box;
}

/* ── Modal backdrop ── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 20, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 1rem;
}

/* ── Modal card ── */
.modal {
  background: #ffffff;
  border-radius: 14px;
  width: 100%;
  max-width: 420px;
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.06),
    0 8px 16px -4px rgba(0,0,0,0.12),
    0 24px 48px -8px rgba(0,0,0,0.18);
  overflow: hidden;
}

/* ── Modal header ── */
.modal-header {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  padding: 1.35rem 1.35rem 0;
}
.modal-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #eef2ff;
  color: #6366f1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  margin-top: 1px;
}
.modal-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 0.2rem;
  line-height: 1.3;
}
.modal-subtitle {
  font-size: 0.78rem;
  color: #94a3b8;
  margin: 0;
  line-height: 1.4;
}
.modal-ctx {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 0.75rem;
  color: #6366f1;
  background: #eef2ff;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
}
.modal-close {
  margin-left: auto;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 0.3rem;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.12s, background 0.12s;
  flex: none;
}
.modal-close:hover { color: #475569; background: #f1f5f9; }

/* ── Modal body / form ── */
.modal-body {
  padding: 1.25rem 1.35rem 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.field-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: #374151;
  letter-spacing: 0.02em;
}
.field-input {
  font-family: inherit;
  font-size: 0.88rem;
  padding: 0.6rem 0.75rem;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #111827;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  width: 100%;
  box-sizing: border-box;
}
.field-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3.5px rgba(99,102,241,0.12);
}
.field-input:disabled { opacity: 0.55; cursor: not-allowed; }
.field-input::placeholder { color: #9ca3af; }
.field-select { cursor: pointer; }
.field-hint {
  font-size: 0.72rem;
  color: #9ca3af;
  margin: 0;
  line-height: 1.4;
}

/* ── Error ── */
.modal-error {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: #be123c;
  background: #fff1f2;
  border: 1px solid #fecdd3;
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  line-height: 1.4;
}
.modal-error svg { flex: none; margin-top: 1px; }

/* ── Footer ── */
.modal-footer {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
  padding-top: 0.25rem;
}
.btn-cancel {
  font-family: inherit;
  font-size: 0.84rem;
  font-weight: 500;
  padding: 0.55rem 1rem;
  border-radius: 8px;
  border: 1.5px solid #e5e7eb;
  background: #fff;
  color: #374151;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.btn-cancel:hover:not(:disabled) { background: #f9fafb; border-color: #d1d5db; }
.btn-cancel:disabled { opacity: 0.45; cursor: not-allowed; }

.btn-create {
  font-family: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  padding: 0.55rem 1.2rem;
  border-radius: 8px;
  border: none;
  background: #6366f1;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  box-shadow: 0 1px 3px rgba(99,102,241,0.3), 0 4px 8px -2px rgba(99,102,241,0.2);
  transition: background 0.12s, box-shadow 0.12s, opacity 0.12s;
}
.btn-create:hover:not(:disabled) {
  background: #4f46e5;
  box-shadow: 0 1px 3px rgba(99,102,241,0.4), 0 6px 12px -2px rgba(99,102,241,0.25);
}
.btn-create:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

/* ── Modal transition ── */
.modal-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.modal-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal,
.modal-leave-to .modal {
  transform: scale(0.96) translateY(8px);
}
</style>

