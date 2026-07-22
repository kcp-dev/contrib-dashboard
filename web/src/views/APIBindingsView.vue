<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from "vue";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "../stores/workspace";
import { listAPIBindings, deleteAPIBinding, createAPIBinding } from "../api/apis";
import { listAPIExports } from "../api/apis";
import { listWorkspaces, childPath } from "../api/kcp";
import type { APIBinding, APIExport, AcceptablePermissionClaim, PermissionClaim } from "../types/apis";
import { apiBindingStatus } from "../types/apis";
import { ApiError } from "../api/client";
import PhaseBadge from "../components/PhaseBadge.vue";
import VerbBadges from "../components/VerbBadges.vue";
import CopyField from "../components/CopyField.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import { usePoller } from "../composables/usePoller";


// ── Inline workspace tree node ────────────────────────────────────────────────
import { defineComponent, h } from "vue";
const WsTreeNode: ReturnType<typeof defineComponent> = defineComponent({
  name: "WsTreeNode",
  props: {
    node: { type: Object as () => WsNode, required: true },
    depth: { type: Number, default: 0 },
    activePath: { type: String, default: "" },
  },
  emits: ["select", "toggle"],
  setup(props, { emit }): () => unknown {
    return () => {
      const n = props.node as WsNode;
      const isActive = n.path === props.activePath;
      const showChevron = n.loading || !n.loaded || n.hasChildren;
      return h("div", { class: "wst-node" }, [
        h("div", {
          class: ["wst-row", isActive ? "wst-active" : ""],
          style: { paddingLeft: (props.depth * 16 + 10) + "px" },
          onClick: () => emit("select", n.path),
        }, [
          showChevron
            ? h("button", { class: ["wst-chev", n.expanded ? "open" : ""], onClick: (e: Event) => { e.stopPropagation(); emit("toggle", n); } },
                n.loading
                  ? h("svg", { class: "spin", width: 11, height: 11, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round" }, [
                      h("polyline", { points: "23 4 23 10 17 10" }),
                      h("path", { d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10" }),
                    ])
                  : h("svg", { width: 11, height: 11, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" }, [
                      h("path", { d: "M5 3l6 5-6 5" }),
                    ])
              )
            : h("span", { class: "wst-spacer" }),
          h("span", { class: "wst-name" }, n.name),
          h("span", { class: "wst-path" }, n.path),
        ]),
        n.expanded && n.children?.length
          ? h("div", n.children.map((child: WsNode) =>
              h(WsTreeNode, { key: child.path, node: child, depth: props.depth + 1, activePath: props.activePath, onSelect: (p: string) => emit("select", p), onToggle: (nd: unknown) => emit("toggle", nd) })
            ))
          : null,
      ]);
    };
  },
});

const wsStore = useWorkspaceStore();
const { current } = storeToRefs(wsStore);

const items    = ref<APIBinding[]>([]);
const loading  = ref(false);
const error    = ref<string | null>(null);
const expanded = ref<string | null>(null);

// ── Create modal ─────────────────────────────────────────────────────────────
const showModal = ref(false);

// Step 1: workspace picker
type WsNode = { path: string; name: string; children: WsNode[]; loaded: boolean; loading: boolean; expanded: boolean; hasChildren: boolean };
const wsTree       = ref<WsNode[]>([]);
const wsLoading    = ref(false);
const highlightedWs = ref<string>("");   // currently highlighted (not yet confirmed)
const selectedWs   = ref<string>("");    // confirmed workspace path
const wsFilter     = ref("");

// Step 2: export picker
const availExports   = ref<APIExport[]>([]);
const exportsLoading = ref(false);
const highlightedExport = ref<APIExport | null>(null);  // highlighted, not yet confirmed
const selectedExport = ref<APIExport | null>(null);     // confirmed export

// Step 3: claims + name
const bName        = ref("");
const loadedClaims = ref<{ claim: PermissionClaim; accept: boolean }[]>([]);
const busy         = ref(false);
const createError  = ref<string | null>(null);

// Set of "path/name" keys for exports already bound in the current workspace
const boundExportKeys = computed(() =>
  new Set(items.value.map(b => {
    const e = b.spec.reference.export;
    if (!e) return "";
    return (e.path ? e.path + "/" : "") + e.name;
  }))
);

function isExportBound(sourcePath: string, ex: APIExport): boolean {
  return boundExportKeys.value.has(sourcePath + "/" + ex.metadata.name);
}

// ── Workspace tree ────────────────────────────────────────────────────────────

// Probe: peek at whether a node has children, marks loaded=true so the
// render condition (!loaded fallback) doesn't show a phantom chevron.
async function probeWsNode(node: WsNode) {
  try {
    const list = await listWorkspaces(node.path);
    const kids = (list.items ?? []).filter(w => !w.metadata.deletionTimestamp);
    node.hasChildren = kids.length > 0;
  } catch {
    // probe failed — leave hasChildren=false (no phantom chevron)
  } finally {
    node.loaded = true;   // always mark probed, so !loaded fallback stops firing
  }
}

async function loadWsChildren(node: WsNode) {
  node.loading = true;
  try {
    const list = await listWorkspaces(node.path);
    node.children = (list.items ?? [])
      .filter(w => !w.metadata.deletionTimestamp)
      .map(w => ({ path: childPath(node.path, w.metadata.name), name: w.metadata.name, children: [], loaded: false, loading: false, expanded: false, hasChildren: false }))
      .sort((a, b) => a.name.localeCompare(b.name));
    node.loaded = true;
    node.hasChildren = node.children.length > 0;
    // Probe each child in parallel so chevrons are accurate before user expands them
    await Promise.all(node.children.map(probeWsNode));
  } catch { node.children = []; node.loaded = true; node.hasChildren = false; }
  finally { node.loading = false; }
}

async function openModal() {
  resetModal();
  showModal.value = true;
  // Load root workspaces
  wsLoading.value = true;
  try {
    const list = await listWorkspaces("root");
    wsTree.value = (list.items ?? [])
      .filter(w => !w.metadata.deletionTimestamp)
      .map(w => ({ path: childPath("root", w.metadata.name), name: w.metadata.name, children: [], loaded: false, loading: false, expanded: false, hasChildren: false }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Probe each root node in parallel so we know which have children before first render
    await Promise.all(wsTree.value.map(probeWsNode));
  } catch { wsTree.value = []; }
  finally { wsLoading.value = false; }
}

async function toggleWsNode(node: WsNode) {
  // Load children on first expand (probe set loaded=true but didn't populate children)
  if (node.hasChildren && node.children.length === 0) await loadWsChildren(node);
  node.expanded = !node.expanded;
}

// Highlight a workspace row (click) — does NOT confirm yet
function highlightWorkspace(path: string) {
  highlightedWs.value = path;
}

// Confirm the highlighted workspace → load its exports
async function confirmWorkspace() {
  const path = highlightedWs.value;
  if (!path) return;
  if (selectedWs.value === path) return;
  selectedWs.value = path;
  highlightedExport.value = null;
  selectedExport.value = null;
  bName.value = "";
  loadedClaims.value = [];
  createError.value = null;

  exportsLoading.value = true;
  try {
    const res = await listAPIExports(path);
    availExports.value = res.items ?? [];
  } catch { availExports.value = []; }
  finally { exportsLoading.value = false; }
}

// Highlight an export row (click) — does NOT confirm yet; bound exports are not selectable
function highlightExport(ex: APIExport) {
  if (isExportBound(selectedWs.value, ex)) return;
  highlightedExport.value = ex;
}

// Confirm the highlighted export → populate claims
function confirmExport() {
  const ex = highlightedExport.value;
  if (!ex) return;
  selectedExport.value = ex;
  bName.value = ex.metadata.name;
  loadedClaims.value = (ex.spec.permissionClaims ?? []).map(c => ({ claim: c, accept: true }));
}

async function create() {
  if (!bName.value || !selectedExport.value || !selectedWs.value) return;
  busy.value = true; createError.value = null;
  try {
    const claims: AcceptablePermissionClaim[] = loadedClaims.value.map(c => ({
      ...c.claim, state: c.accept ? "Accepted" : "Rejected", selector: { matchAll: true },
    }));
    await createAPIBinding(
      current.value,
      bName.value,
      { path: selectedWs.value, name: selectedExport.value.metadata.name },
      claims,
    );
    const createdName = bName.value;
    showModal.value = false; resetModal();
    // Poll until the new binding appears in the list
    void pollUntil(list => list.some(x => x.metadata.name === createdName));
  } catch (e) {
    createError.value = e instanceof ApiError ? e.message : String(e);
  } finally { busy.value = false; }
}

function resetModal() {
  selectedWs.value = ""; highlightedWs.value = ""; wsTree.value = []; wsFilter.value = "";
  availExports.value = []; selectedExport.value = null; highlightedExport.value = null;
  bName.value = ""; loadedClaims.value = []; createError.value = null; busy.value = false;
}
function closeModal() { if (busy.value) return; showModal.value = false; resetModal(); }

// ── List + polling ───────────────────────────────────────────────────────────
async function fetchBindings() {
  const list = await listAPIBindings(current.value);
  return list.items ?? [];
}

async function load() {
  loading.value = true; error.value = null;
  poller?.stop(); pollStatus.value = "idle";
  try {
    items.value = await fetchBindings();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    items.value = [];
  } finally { loading.value = false; }
}

let poller: ReturnType<typeof usePoller> | null = null;
const pollStatus = ref<"idle" | "polling" | "timeout">("idle");

async function pollUntil(done: (list: APIBinding[]) => boolean) {
  poller?.stop();
  poller = usePoller(
    async () => {
      const list = await fetchBindings();
      items.value = list;
      return list;
    },
    done,
    { interval: 1500, timeout: 15_000 },
  );
  pollStatus.value = "polling";
  await poller.poll();
  pollStatus.value = poller.state.value;
}

function userRefresh() {
  pollStatus.value = "idle";
  poller?.stop();
  load();
}

function toggle(name: string) { expanded.value = expanded.value === name ? null : name; }

// ── Delete confirm ────────────────────────────────────────────────────────────
const confirmBinding = ref<APIBinding | null>(null);
const deleting       = ref(false);

async function doDelete() {
  const b = confirmBinding.value;
  if (!b) return;
  deleting.value = true;
  const deletedName = b.metadata.name;
  try {
    await deleteAPIBinding(current.value, deletedName);
    confirmBinding.value = null;
    // Poll until binding is gone
    void pollUntil(list => !list.some(x => x.metadata.name === deletedName));
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    confirmBinding.value = null;
  } finally { deleting.value = false; }
}

async function remove(b: APIBinding) {
  confirmBinding.value = b;
}

function exportRefLabel(b: APIBinding) {
  const e = b.spec.reference.export;
  if (!e) return "—";
  return e.path ? `${e.path} / ${e.name}` : e.name;
}
const gr = (group?: string, resource?: string) => group ? `${resource}.${group}` : (resource ?? "");

onMounted(load);
onUnmounted(() => poller?.stop());
watch(current, () => { closeModal(); expanded.value = null; poller?.stop(); pollStatus.value = "idle"; load(); });
</script>

<template>
  <div class="page">

    <!-- Page header -->
    <div class="page-head">
      <div>
        <h1 class="page-title">API Bindings</h1>
        <p class="page-sub">Workspace <code class="ws-code">{{ current }}</code></p>
      </div>
      <div class="head-actions">
        <button
          class="btn-secondary" :class="{ 'btn-warn': pollStatus === 'timeout' }"
          @click="userRefresh" :disabled="loading"
          :title="pollStatus === 'timeout' ? 'Refresh timed out — click to retry' : pollStatus === 'polling' ? 'Syncing…' : 'Refresh'"
        >
          <!-- polling: spinner -->
          <svg v-if="pollStatus === 'polling'" class="spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          <!-- timeout: warning triangle -->
          <svg v-else-if="pollStatus === 'timeout'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <!-- idle: normal refresh icon -->
          <svg v-else :class="{ spin: loading }" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          {{ pollStatus === 'polling' ? 'Syncing…' : pollStatus === 'timeout' ? 'Timed out' : 'Refresh' }}
        </button>
        <button class="btn-primary" @click="openModal">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
          New binding
        </button>
      </div>
    </div>


    <!-- Global error -->
    <div v-if="error" class="alert-error">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      {{ error }}
    </div>

    <!-- Loading -->
    <div v-if="loading && !items.length" class="loading-row">
      <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      Loading…
    </div>

    <!-- Empty -->
    <div v-else-if="!items.length && !error && !showModal" class="empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".3">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
      <p>No API bindings in <strong>{{ current }}</strong></p>
    </div>

    <!-- List -->
    <div v-else-if="items.length" class="card-list">
      <div v-for="b in items" :key="b.metadata.name" class="card" :class="{ open: expanded === b.metadata.name }">

        <!-- Summary -->
        <div class="summary" @click="toggle(b.metadata.name)">
          <button class="chevron" :class="{ open: expanded === b.metadata.name }" tabindex="-1">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 3l6 5-6 5"/>
            </svg>
          </button>

          <span class="ex-name">{{ b.metadata.name }}</span>
          <PhaseBadge :phase="apiBindingStatus(b).label" />

          <div class="summary-stats">
            <span class="stat export-ref">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              {{ exportRefLabel(b) }}
            </span>
            <span class="stat">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              {{ b.status?.boundResources?.length || 0 }} bound
            </span>
          </div>

          <button class="del-btn" title="Delete binding" @click.stop="remove(b)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>

        <!-- Detail -->
        <div v-if="expanded === b.metadata.name" class="detail">

          <!-- Condition health — only shown when degraded -->
          <section v-if="apiBindingStatus(b).messages.some(m => !m.ok)" class="section">
            <h4 class="section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Condition health
            </h4>
            <div class="health-grid">
              <div v-for="m in apiBindingStatus(b).messages" :key="m.type" class="health-row" :class="m.ok ? 'ok' : 'warn'">
                <svg v-if="m.ok" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l4 4 8-8"/></svg>
                <svg v-else width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M2 2l12 12M14 2L2 14"/></svg>
                <span class="health-type">{{ m.type }}</span>
                <span v-if="m.message" class="health-msg">{{ m.message }}</span>
              </div>
            </div>
          </section>

          <!-- Export reference -->
          <section class="section">
            <h4 class="section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Export reference
            </h4>
            <CopyField :value="exportRefLabel(b)" />
          </section>

          <!-- Bound resources -->
          <section class="section">
            <h4 class="section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              Bound resources
              <span class="pill">{{ b.status?.boundResources?.length || 0 }}</span>
            </h4>
            <div v-if="b.status?.boundResources?.length" class="res-grid">
              <div v-for="r in b.status.boundResources" :key="r.group + r.resource" class="res-chip">
                <span class="res-name">{{ r.resource }}</span><span v-if="r.group" class="res-group">.{{ r.group }}</span>
              </div>
            </div>
            <p v-else class="empty-inline">No resources bound yet</p>
          </section>

          <!-- Permission claims -->
          <section v-if="b.spec.permissionClaims?.length" class="section">
            <h4 class="section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Permission claims
              <span class="pill">{{ b.spec.permissionClaims.length }}</span>
            </h4>
            <div class="claim-table">
              <div class="claim-header">
                <span>Resource</span><span>Verbs</span><span>State</span>
              </div>
              <div v-for="(c, i) in b.spec.permissionClaims" :key="i" class="claim-row">
                <span class="claim-res">{{ gr(c.group, c.resource) }}</span>
                <VerbBadges :verbs="c.verbs" />
                <span class="state-badge" :class="c.state === 'Accepted' ? 'accepted' : 'rejected'">{{ c.state }}
                </span>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>

  </div>
    <!-- New Binding Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showModal" class="modal-backdrop" @click.self="closeModal">
          <div class="modal" role="dialog" aria-modal="true">

            <!-- Modal header -->
            <div class="modal-head">
              <div class="modal-head-left">
                <div class="modal-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </div>
                <div>
                  <h2 class="modal-title">New API Binding</h2>
                  <p class="modal-sub">Binding will be created in <code class="ws-code">{{ current }}</code></p>
                </div>
              </div>
              <button class="modal-close" @click="closeModal">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div class="modal-body">
              <!-- ── Step 1: workspace picker ── -->
              <div class="step">
                <div class="step-label">
                  <span class="step-num" :class="selectedWs ? 'done' : 'active'">
                    <svg v-if="selectedWs" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l4 4 8-8"/></svg>
                    <span v-else>1</span>
                  </span>
                  <span class="step-title">Choose export workspace</span>
                  <code v-if="selectedWs" class="step-value" @click="selectedWs = ''; highlightedWs = ''; selectedExport = null; highlightedExport = null">{{ selectedWs }} <span class="step-change">change</span></code>
                </div>

                <div v-if="!selectedWs" class="ws-picker">
                  <p v-if="wsLoading" class="picker-hint">
                    <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    Loading workspaces…
                  </p>
                  <template v-else>
                    <div class="ws-tree">
                      <WsTreeNode
                        v-for="node in wsTree" :key="node.path"
                        :node="node" :depth="0"
                        :activePath="highlightedWs"
                        @select="highlightWorkspace"
                        @toggle="toggleWsNode"
                      />
                      <p v-if="!wsTree.length" class="picker-hint">No workspaces found</p>
                    </div>
                    <div class="picker-confirm-row">
                      <span class="picker-selected-label">
                        <template v-if="highlightedWs">
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l4 4 8-8"/></svg>
                          <code>{{ highlightedWs }}</code>
                        </template>
                        <span v-else class="picker-none">Select a workspace above</span>
                      </span>
                      <button class="btn-confirm" :disabled="!highlightedWs" @click="confirmWorkspace">
                        Use this workspace
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
                      </button>
                    </div>
                  </template>
                </div>
              </div>

              <!-- ── Step 2: export picker ── -->
              <div class="step" :class="{ disabled: !selectedWs }">
                <div class="step-label">
                  <span class="step-num" :class="selectedExport ? 'done' : selectedWs ? 'active' : ''">
                    <svg v-if="selectedExport" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l4 4 8-8"/></svg>
                    <span v-else>2</span>
                  </span>
                  <span class="step-title">Choose API export</span>
                  <code v-if="selectedExport" class="step-value" @click="selectedExport = null; highlightedExport = null; bName = ''; loadedClaims = []">{{ selectedExport.metadata.name }} <span class="step-change">change</span></code>
                </div>

                <div v-if="selectedWs && !selectedExport" class="export-picker">
                  <p v-if="exportsLoading" class="picker-hint">
                    <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    Loading exports…
                  </p>
                  <template v-else>
                    <p v-if="!availExports.length" class="picker-hint">No exports in this workspace</p>
                    <template v-else>
                      <div class="export-list">
                        <button
                          v-for="ex in availExports" :key="ex.metadata.name"
                          class="export-option"
                          :class="{
                            'export-option--active': highlightedExport === ex,
                            'export-option--bound':  isExportBound(selectedWs, ex),
                          }"
                          :disabled="isExportBound(selectedWs, ex)"
                          @click="highlightExport(ex)"
                        >
                          <div class="export-opt-left">
                            <span class="export-opt-check">
                              <svg v-if="highlightedExport === ex" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l4 4 8-8"/></svg>
                            </span>
                            <span class="export-opt-name">{{ ex.metadata.name }}</span>
                          </div>
                          <div class="export-opt-right">
                            <span class="export-opt-meta">
                              <span>{{ (ex.spec.resources ?? []).length || (ex.spec.latestResourceSchemas ?? []).length }} resource{{ ((ex.spec.resources ?? []).length || (ex.spec.latestResourceSchemas ?? []).length) !== 1 ? 's' : '' }}</span>
                              <span v-if="ex.spec.permissionClaims?.length">· {{ ex.spec.permissionClaims.length }} claim{{ ex.spec.permissionClaims.length !== 1 ? 's' : '' }}</span>
                            </span>
                            <span v-if="isExportBound(selectedWs, ex)" class="export-bound-badge">Already bound</span>
                          </div>
                        </button>
                      </div>
                      <div class="picker-confirm-row">
                        <span class="picker-selected-label">
                          <template v-if="highlightedExport">
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l4 4 8-8"/></svg>
                            <code>{{ highlightedExport.metadata.name }}</code>
                          </template>
                          <span v-else class="picker-none">Select an export above</span>
                        </span>
                        <button class="btn-confirm" :disabled="!highlightedExport" @click="confirmExport">
                          Use this export
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
                        </button>
                      </div>
                    </template>
                  </template>
                </div>
              </div>

              <!-- ── Step 3: review claims + name ── -->
              <div class="step" :class="{ disabled: !selectedExport }">
                <div class="step-label">
                  <span class="step-num" :class="selectedExport ? 'active' : ''">3</span>
                  <span class="step-title">Review &amp; confirm</span>
                </div>

                <div v-if="selectedExport" class="review-section">
                  <!-- Binding name -->
                  <div class="field">
                    <label class="field-label">Binding name</label>
                    <input class="field-input" v-model="bName" :disabled="busy" autocomplete="off" spellcheck="false" />
                  </div>

                  <!-- Claims -->
                  <div v-if="loadedClaims.length" class="claims-block">
                    <div class="field-label" style="margin-bottom:0.45rem">
                      Permission claims
                      <span class="claims-count">{{ loadedClaims.length }}</span>
                    </div>
                    <table class="claims-table">
                      <thead>
                        <tr>
                          <th>Resource</th>
                          <th>Verbs</th>
                          <th>Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(c, i) in loadedClaims" :key="i">
                          <td class="ct-res">{{ gr(c.claim.group, c.claim.resource) }}</td>
                          <td class="ct-verbs"><VerbBadges :verbs="c.claim.verbs" /></td>
                          <td class="ct-decision">
                            <div class="decision-btns">
                              <button
                                class="dbtn dbtn-accept" :class="{ active: c.accept }"
                                @click="c.accept = true"
                              >Accept</button>
                              <button
                                class="dbtn dbtn-reject" :class="{ active: !c.accept }"
                                @click="c.accept = false"
                              >Reject</button>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p v-else class="picker-hint" style="margin-top: 0.5rem">No permission claims required</p>

                  <div v-if="createError" class="alert-error" style="margin-top:0.75rem">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                    {{ createError }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Modal footer -->
            <div class="modal-footer">
              <button class="btn-secondary" @click="closeModal" :disabled="busy">Cancel</button>
              <button class="btn-primary" @click="create" :disabled="busy || !selectedExport || !bName.trim()">
                <svg v-if="busy" class="spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                {{ busy ? 'Creating…' : 'Create binding' }}
              </button>
            </div>

          </div>
        </div>
      </Transition>
    </Teleport>

    <ConfirmDialog
      v-if="confirmBinding"
      :title="`Delete binding '${confirmBinding.metadata.name}'?`"
      message="This will remove the API binding and all resources it exposed in this workspace."
      confirm-label="Delete binding"
      :busy="deleting"
      @confirm="doDelete"
      @cancel="confirmBinding = null"
    />

</template>

<style scoped>
/* ── Page shell ── */
.page { display: flex; flex-direction: column; gap: 0; height: 100%; }

.page-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 1.25rem; gap: 1rem;
}
.page-title { margin: 0 0 0.2rem; font-size: 1.15rem; font-weight: 700; color: #0f172a; }
.page-sub   { margin: 0; font-size: 0.78rem; color: #94a3b8; }
.ws-code {
  font-family: ui-monospace, Menlo, monospace; font-size: 0.75rem;
  background: #f1f5f9; color: #475569; padding: 0.1rem 0.4rem; border-radius: 4px;
}
.head-actions { display: flex; gap: 0.5rem; flex: none; }

/* ── Buttons ── */
.btn-primary, .btn-secondary, .btn-load {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-family: inherit; font-size: 0.8rem; font-weight: 600;
  padding: 0.42rem 0.85rem; border-radius: 7px; cursor: pointer;
  white-space: nowrap; transition: background 0.12s, border-color 0.12s, opacity 0.12s;
}
.btn-primary {
  background: #6366f1; color: #fff; border: 1px solid #6366f1;
  box-shadow: 0 1px 3px rgba(99,102,241,0.25);
}
.btn-primary:hover:not(:disabled) { background: #4f46e5; }
.btn-primary:disabled { opacity: 0.5; cursor: default; }
.btn-secondary {
  background: #fff; color: #475569; border: 1px solid #e2e8f0;
}
.btn-secondary:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
.btn-secondary:disabled { opacity: 0.5; cursor: default; }
.btn-warn { background: #fffbeb; color: #92400e; border-color: #fde68a; }
.btn-warn:hover:not(:disabled) { background: #fef3c7; border-color: #fcd34d; }
.btn-load {
  background: #f8fafc; color: #475569; border: 1px solid #e2e8f0;
  margin-top: 0.75rem;
}
.btn-load:hover:not(:disabled) { background: #f1f5f9; }
.btn-load:disabled { opacity: 0.5; cursor: default; }

/* ── Create card ── */
.create-card {
  background: #fff; border: 1px solid #c7d2fe;
  border-radius: 10px; padding: 1.25rem;
  margin-bottom: 1.25rem;
  box-shadow: 0 0 0 3px rgba(99,102,241,0.07);
}
.create-title {
  display: flex; align-items: center; gap: 0.45rem;
  font-size: 0.88rem; font-weight: 700; color: #1e293b;
  margin: 0 0 1.1rem;
}
.form-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;
}
@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }

.field { display: flex; flex-direction: column; gap: 0.3rem; }
.field-label {
  font-size: 0.7rem; font-weight: 700; color: #374151; letter-spacing: 0.02em;
  display: flex; align-items: center; gap: 0.3rem;
}
.field-hint-inline { font-weight: 400; color: #94a3b8; font-size: 0.65rem; }
.field-req { color: #ef4444; }
.field-input {
  font-family: inherit; font-size: 0.84rem;
  padding: 0.5rem 0.7rem; border: 1.5px solid #e5e7eb; border-radius: 7px;
  background: #fff; color: #111827; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.field-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
.field-input:disabled { opacity: 0.55; }

.claims-section { margin-top: 1rem; }
.claims-intro { margin: 0 0 0.65rem; font-size: 0.78rem; color: #64748b; }

.form-footer {
  display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;
  padding-top: 1rem; border-top: 1px solid #f1f5f9;
}

/* ── States ── */
.alert-error {
  display: flex; align-items: flex-start; gap: 0.5rem;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
  color: #dc2626; font-size: 0.82rem; padding: 0.7rem 0.85rem; margin-bottom: 1rem;
}
.alert-error svg { flex: none; margin-top: 1px; }
.loading-row { display: flex; align-items: center; gap: 0.5rem; color: #94a3b8; font-size: 0.85rem; padding: 2rem 0; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; padding: 4rem 1rem; color: #94a3b8; text-align: center; }
.empty p { margin: 0; font-size: 0.88rem; }

/* ── Card list ── */
.card-list { display: flex; flex-direction: column; gap: 0.5rem; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; transition: box-shadow 0.12s; }
.card:hover { box-shadow: 0 1px 6px rgba(0,0,0,0.06); }
.card.open  { border-color: #c7d2fe; box-shadow: 0 0 0 3px rgba(99,102,241,0.08); }

.summary {
  display: flex; align-items: center; gap: 0.7rem;
  padding: 0.75rem 1rem; cursor: pointer; user-select: none;
  transition: background 0.08s;
}
.summary:hover { background: #fafafa; }

.chevron {
  background: none; border: none; padding: 0; cursor: pointer;
  color: #94a3b8; display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 4px; flex: none;
  transition: transform 0.18s ease, color 0.12s, background 0.12s;
}
.chevron.open { transform: rotate(90deg); color: #6366f1; }
.summary:hover .chevron { color: #475569; background: #f1f5f9; }

.ex-name {
  font-size: 0.92rem; font-weight: 700; color: #0f172a;
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.summary-stats { display: flex; gap: 0.65rem; }
.stat { display: inline-flex; align-items: center; gap: 0.28rem; font-size: 0.72rem; color: #94a3b8; white-space: nowrap; }
.export-ref { font-family: ui-monospace, Menlo, monospace; color: #64748b; }

.del-btn {
  background: none; border: none; cursor: pointer; padding: 0.25rem;
  color: #cbd5e1; border-radius: 5px; display: flex; align-items: center;
  transition: color 0.12s, background 0.12s; flex: none;
}
.del-btn:hover { color: #ef4444; background: #fef2f2; }

/* Detail */
.detail {
  border-top: 1px solid #f1f5f9; background: #fafbfc;
  padding: 0 1.25rem 1.25rem;
  display: flex; flex-direction: column; gap: 0;
}
.section { padding-top: 1.1rem; }
.section + .section { border-top: 1px solid #f1f5f9; }
.section-title {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.07em; color: #94a3b8; margin: 0 0 0.65rem;
}
.pill {
  background: #e2e8f0; color: #64748b; border-radius: 999px;
  padding: 0 0.4rem; font-size: 0.65rem; font-weight: 700; margin-left: 0.15rem;
}
.res-grid { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.res-chip {
  display: inline-flex; align-items: baseline;
  background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px;
  padding: 0.2rem 0.55rem;
  font-family: ui-monospace, Menlo, monospace; font-size: 0.75rem;
}
.res-name  { color: #1e293b; font-weight: 600; }
.res-group { color: #94a3b8; }

.claim-table { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
.claim-header {
  display: grid; grid-template-columns: 1fr auto auto;
  padding: 0.4rem 0.85rem; background: #f8fafc;
  font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: #94a3b8; border-bottom: 1px solid #e2e8f0;
  gap: 1rem;
}
.claim-row {
  display: grid; grid-template-columns: 1fr auto auto;
  align-items: center; gap: 1rem;
  padding: 0.5rem 0.85rem; border-bottom: 1px solid #f1f5f9;
}
.claim-row:last-child { border-bottom: none; }
.claim-row:nth-child(even) { background: #fafbfc; }
.claim-editable { cursor: pointer; }
.claim-res { font-family: ui-monospace, Menlo, monospace; font-size: 0.78rem; min-width: 0; }

.claims-block { margin-top: 0.85rem; }
.claims-count {
  background: #e2e8f0; color: #64748b; border-radius: 999px;
  padding: 0 0.4rem; font-size: 0.65rem; font-weight: 700; margin-left: 0.25rem;
}

/* read-only state badges (binding detail) */
.state-badge {
  display: inline-flex; align-items: center;
  font-size: 0.68rem; font-weight: 700; padding: 0.15rem 0.5rem;
  border-radius: 999px; border: 1px solid transparent; white-space: nowrap;
}
.accepted { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.rejected  { background: #fef2f2; color: #dc2626; border-color: #fecaca; }

.claims-table {
  width: 100%; border-collapse: collapse;
  border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;
  font-size: 0.8rem;
}
.claims-table thead tr {
  background: #f8fafc;
}
.claims-table th {
  text-align: left; padding: 0.38rem 0.75rem;
  font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: #94a3b8;
  border-bottom: 1px solid #e2e8f0;
}
.claims-table tbody tr { border-bottom: 1px solid #f1f5f9; }
.claims-table tbody tr:last-child { border-bottom: none; }
.claims-table td { padding: 0.45rem 0.75rem; vertical-align: middle; }

.ct-res {
  font-family: ui-monospace, Menlo, monospace; font-size: 0.78rem;
  font-weight: 600; color: #1e293b; white-space: nowrap;
}
.ct-verbs { white-space: nowrap; }
.ct-decision { white-space: nowrap; }

/* Accept / Reject segmented buttons */
.decision-btns {
  display: inline-flex; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;
}
.dbtn {
  padding: 0.28rem 0.65rem;
  font-family: inherit; font-size: 0.72rem; font-weight: 600;
  border: none; background: #fff; cursor: pointer;
  color: #94a3b8;
  transition: background 0.1s, color 0.1s;
}
.dbtn + .dbtn { border-left: 1px solid #e2e8f0; }
.dbtn:hover { background: #f1f5f9; color: #475569; }
.dbtn-accept.active { background: #dcfce7; color: #15803d; }
.dbtn-reject.active { background: #fee2e2; color: #dc2626; }

.empty-inline { margin: 0; font-size: 0.78rem; color: #94a3b8; font-style: italic; }


/* ── Condition indicator dots ── */
.cond-row {
  display: flex; gap: 0.4rem; align-items: center; flex-wrap: nowrap;
}
.cond-dot {
  display: inline-flex; align-items: center; gap: 0.2rem;
  font-size: 0.65rem; font-weight: 700;
  padding: 0.15rem 0.45rem 0.15rem 0.3rem;
  border-radius: 999px; border: 1px solid transparent; white-space: nowrap;
}
.cond-dot.ok   { background: #f0fdf4; color: #15803d; border-color: #86efac; }
.cond-dot.warn { background: #fef2f2; color: #dc2626; border-color: #fca5a5; }

/* ── Condition health grid (binding detail) ── */
.health-grid { display: flex; flex-direction: column; gap: 0.3rem; }
.health-row {
  display: flex; align-items: flex-start; gap: 0.45rem;
  padding: 0.4rem 0.65rem; border-radius: 7px; font-size: 0.78rem;
}
.health-row svg { flex: none; margin-top: 1px; }
.health-row.ok   { background: #f0fdf4; color: #15803d; }
.health-row.warn { background: #fef2f2; color: #dc2626; }
.health-type { font-weight: 600; }
.health-msg  { color: inherit; opacity: 0.75; margin-left: 0.35rem; font-style: italic; }
@keyframes spin { to { transform: rotate(360deg); } }
.spin { display: inline-block; animation: spin 0.7s linear infinite; transform-box: fill-box; transform-origin: center; }
/* ── Modal ── */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(15,23,42,0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 200; padding: 1rem;
}
.modal {
  background: #fff; border-radius: 14px;
  width: 100%; max-width: 560px; max-height: 88vh;
  display: flex; flex-direction: column;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 8px 24px -4px rgba(0,0,0,0.14), 0 32px 56px -8px rgba(0,0,0,0.18);
  overflow: hidden;
}
.modal-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 1.15rem 1.25rem 0; flex: none; gap: 0.75rem;
}
.modal-head-left { display: flex; align-items: flex-start; gap: 0.75rem; }
.modal-icon {
  width: 34px; height: 34px; border-radius: 8px;
  background: #eef2ff; color: #6366f1;
  display: flex; align-items: center; justify-content: center; flex: none;
}
.modal-title { margin: 0 0 0.18rem; font-size: 0.95rem; font-weight: 700; color: #0f172a; }
.modal-sub   { margin: 0; font-size: 0.75rem; color: #94a3b8; }
.modal-close {
  background: none; border: none; cursor: pointer; color: #94a3b8;
  padding: 0.3rem; border-radius: 6px; display: flex; flex: none;
  transition: background 0.12s, color 0.12s;
}
.modal-close:hover { background: #f1f5f9; color: #475569; }

.modal-body {
  flex: 1; overflow-y: auto; padding: 1rem 1.25rem;
  display: flex; flex-direction: column; gap: 0;
}
.modal-footer {
  display: flex; justify-content: flex-end; gap: 0.5rem;
  padding: 0.85rem 1.25rem;
  border-top: 1px solid #f1f5f9; flex: none;
}

/* ── Steps ── */
.step {
  padding: 0.9rem 0;
  border-bottom: 1px solid #f1f5f9;
}
.step:last-child { border-bottom: none; }
.step.disabled { opacity: 0.4; pointer-events: none; }

.step-label {
  display: flex; align-items: center; gap: 0.55rem; margin-bottom: 0.7rem;
}
.step-num {
  width: 20px; height: 20px; border-radius: 50%; flex: none;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.65rem; font-weight: 800;
  background: #f1f5f9; color: #94a3b8; border: 1.5px solid #e2e8f0;
}
.step-num.active { background: #eef2ff; color: #6366f1; border-color: #c7d2fe; }
.step-num.done   { background: #f0fdf4; color: #16a34a; border-color: #86efac; }
.step-title { font-size: 0.82rem; font-weight: 700; color: #1e293b; }
.step-value {
  font-family: ui-monospace, Menlo, monospace; font-size: 0.72rem;
  background: #f1f5f9; color: #475569; padding: 0.15rem 0.5rem;
  border-radius: 5px; cursor: pointer; margin-left: auto;
  transition: background 0.1s;
}
.step-value:hover { background: #e2e8f0; }
.step-change { color: #6366f1; margin-left: 0.3rem; font-style: normal; }

/* ── Workspace tree picker ── */
.ws-picker { margin-left: 1.8rem; }
.ws-tree {
  border: 1px solid #e2e8f0; border-radius: 8px;
  overflow: hidden; max-height: 200px; overflow-y: auto;
}
.picker-hint {
  font-size: 0.78rem; color: #94a3b8; margin: 0;
  display: flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0;
}

/* Confirm row — sits below tree/list, has selection summary + confirm button */
.picker-confirm-row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  margin-top: 0.6rem; padding: 0.5rem 0.65rem;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
}
.picker-selected-label {
  display: flex; align-items: center; gap: 0.35rem;
  font-size: 0.75rem; color: #16a34a; font-weight: 600; flex: 1; min-width: 0;
}
.picker-selected-label code {
  font-family: ui-monospace, Menlo, monospace; font-size: 0.72rem;
  color: #0f172a; background: #e2e8f0; padding: 0.1rem 0.4rem; border-radius: 4px;
}
.picker-none { color: #94a3b8; font-weight: 400; font-style: italic; }
.btn-confirm {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-family: inherit; font-size: 0.75rem; font-weight: 700;
  padding: 0.35rem 0.75rem; border-radius: 7px; cursor: pointer; flex: none;
  white-space: nowrap;
  background: #6366f1; color: #fff; border: 1px solid #6366f1;
  box-shadow: 0 1px 3px rgba(99,102,241,0.2);
  transition: background 0.12s, opacity 0.12s;
}
.btn-confirm:hover:not(:disabled) { background: #4f46e5; }
.btn-confirm:disabled { opacity: 0.35; cursor: default; }

/* Workspace tree nodes (render fn) */
:deep(.wst-node) {}
:deep(.wst-row) {
  display: flex; align-items: center; gap: 0.35rem;
  padding: 0.32rem 0.75rem 0.32rem 0; cursor: pointer;
  font-size: 0.8rem; color: #475569;
  transition: background 0.07s;
}
:deep(.wst-row:hover) { background: #f8fafc; color: #0f172a; }
:deep(.wst-row.wst-active) { background: #eef2ff; color: #4338ca; }
:deep(.wst-chev) {
  background: none; border: none; cursor: pointer; color: #94a3b8;
  width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;
  flex: none; border-radius: 3px; padding: 0;
  transition: transform 0.15s ease, color 0.1s;
}
:deep(.wst-chev.open) { transform: rotate(90deg); color: #6366f1; }
:deep(.wst-spacer) { display: inline-block; width: 18px; flex: none; }
:deep(.wst-name) { font-weight: 600; flex: none; }
:deep(.wst-path) {
  font-family: ui-monospace, Menlo, monospace; font-size: 0.68rem;
  color: #94a3b8; margin-left: 0.3rem; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}

/* ── Export picker ── */
.export-picker { margin-left: 1.8rem; }
.export-list {
  display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0;
}
.export-option {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.55rem 0.75rem; border-radius: 8px;
  border: 1.5px solid #e2e8f0; background: #fff;
  cursor: pointer; text-align: left; width: 100%;
  transition: border-color 0.12s, background 0.12s;
  font-family: inherit;
}
.export-option:hover:not(:disabled) { border-color: #c7d2fe; background: #fafbff; }
.export-option--active { border-color: #6366f1 !important; background: #eef2ff !important; }
.export-option--bound {
  background: #f8fafc !important; border-color: #e2e8f0 !important;
  cursor: not-allowed; opacity: 0.72;
}
.export-opt-left { display: flex; align-items: center; gap: 0.45rem; min-width: 0; }
.export-opt-right { display: flex; align-items: center; gap: 0.55rem; flex: none; }
.export-opt-check {
  width: 16px; height: 16px; flex: none;
  display: flex; align-items: center; justify-content: center;
  color: #6366f1;
}
.export-opt-name { font-size: 0.85rem; font-weight: 700; color: #1e293b; }
.export-opt-meta { font-size: 0.72rem; color: #94a3b8; white-space: nowrap; }
.export-bound-badge {
  font-size: 0.65rem; font-weight: 700;
  padding: 0.1rem 0.45rem; border-radius: 999px;
  background: #f0fdf4; color: #16a34a; border: 1px solid #86efac;
  white-space: nowrap;
}

/* ── Review section ── */
.review-section { margin-left: 1.8rem; }
.claims-hint { font-size: 0.65rem; color: #94a3b8; font-weight: 400; margin-left: 0.3rem; }

/* ── Modal transitions ── */
.modal-enter-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.modal-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal, .modal-leave-to .modal { transform: scale(0.96) translateY(10px); }

</style>
