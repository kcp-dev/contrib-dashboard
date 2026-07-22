<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import yaml from "js-yaml";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "../stores/workspace";
import {
  discoverResources,
  listObjects,
  type APIResourceInfo,
  type GenericObject,
  type ResourceOrigin,
} from "../api/discovery";
import { ApiError } from "../api/client";

const wsStore = useWorkspaceStore();
const { current } = storeToRefs(wsStore);

const resources = ref<APIResourceInfo[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const filter = ref("");
const ORIGINS: ResourceOrigin[] = ["native", "kcp", "crd", "apibinding"];
// null = "all categories visible" (default), string = solo-selected category
const soloOrigin = ref<ResourceOrigin | null>(null);

const selected = ref<APIResourceInfo | null>(null);
const objects = ref<GenericObject[]>([]);
const objLoading = ref(false);
const objError = ref<string | null>(null);

const detail = ref<GenericObject | null>(null);

// ── Resizable splitter ────────────────────────────────────────────
const panelWidth = ref(320);
const MIN_WIDTH = 160;
const MAX_WIDTH = 520;
let dragging = false;
let startX = 0;
let startWidth = 0;

function onSplitterMousedown(e: MouseEvent) {
  dragging = true;
  startX = e.clientX;
  startWidth = panelWidth.value;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

function onMousemove(e: MouseEvent) {
  if (!dragging) return;
  const delta = e.clientX - startX;
  panelWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
}

function onMouseup() {
  if (!dragging) return;
  dragging = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

onMounted(() => {
  window.addEventListener("mousemove", onMousemove);
  window.addEventListener("mouseup", onMouseup);
});
onUnmounted(() => {
  window.removeEventListener("mousemove", onMousemove);
  window.removeEventListener("mouseup", onMouseup);
});

// ── Data loading ──────────────────────────────────────────────────
async function loadTypes() {
  loading.value = true;
  error.value = null;
  selected.value = null;
  objects.value = [];
  try {
    resources.value = await discoverResources(current.value);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    resources.value = [];
  } finally {
    loading.value = false;
  }
}

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return resources.value.filter((r) => {
    if (soloOrigin.value !== null && r.origin !== soloOrigin.value) return false;
    if (!q) return true;
    return (
      r.kind.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.group.toLowerCase().includes(q)
    );
  });
});

function toggleOrigin(o: ResourceOrigin) {
  // Click selected → back to all; click unselected → solo that category
  soloOrigin.value = soloOrigin.value === o ? null : o;
}

async function select(res: APIResourceInfo) {
  selected.value = res;
  objLoading.value = true;
  objError.value = null;
  objects.value = [];
  try {
    const list = await listObjects(current.value, res);
    objects.value = list.items ?? [];
  } catch (e) {
    objError.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    objLoading.value = false;
  }
}

function age(ts?: string): string {
  if (!ts) return "";
  const d = Date.now() - new Date(ts).getTime();
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Detail / format ───────────────────────────────────────────────
const format = ref<"yaml" | "json">("yaml");
const hideManagedFields = ref(true);

const detailObject = computed(() => {
  if (!detail.value) return null;
  if (!hideManagedFields.value) return detail.value;
  const { managedFields: _drop, ...restMeta } = detail.value.metadata ?? {};
  return { ...detail.value, metadata: restMeta };
});

const detailText = computed(() => {
  if (!detailObject.value) return "";
  if (format.value === "json") return JSON.stringify(detailObject.value, null, 2);
  try {
    return yaml.dump(detailObject.value, { noRefs: true, sortKeys: false, lineWidth: -1 });
  } catch {
    return JSON.stringify(detailObject.value, null, 2);
  }
});

// ── Syntax highlighting ───────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(cls: string, s: string): string {
  return `<span class="${cls}">${esc(s)}</span>`;
}

function highlightJson(src: string): string {
  // Walk the raw string char by char — no regex-on-HTML-escaped-text pitfalls
  let out = "";
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];

    // String token
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === '"') { j++; break; }
        j++;
      }
      const token = src.slice(i, j);
      // Peek past whitespace to see if a colon follows → it's a key
      let k = j;
      while (k < n && (src[k] === " " || src[k] === "\t")) k++;
      if (src[k] === ":") {
        out += span("hl-key", token);
      } else {
        out += span("hl-str", token);
      }
      i = j;
      continue;
    }

    // Number
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      let j = i;
      if (src[j] === "-") j++;
      while (j < n && ((src[j] >= "0" && src[j] <= "9") || src[j] === "." || src[j] === "e" || src[j] === "E" || src[j] === "+" || src[j] === "-")) j++;
      out += span("hl-num", src.slice(i, j));
      i = j;
      continue;
    }

    // Keywords
    if (src.startsWith("true", i))  { out += span("hl-bool", "true");  i += 4; continue; }
    if (src.startsWith("false", i)) { out += span("hl-bool", "false"); i += 5; continue; }
    if (src.startsWith("null", i))  { out += span("hl-null", "null");  i += 4; continue; }

    // Structural chars & whitespace — escape and emit
    out += esc(ch);
    i++;
  }
  return out;
}

function highlightYaml(src: string): string {
  return src.split("\n").map((line) => {
    if (!line.trim()) return "";

    // Comment
    if (/^\s*#/.test(line))
      return span("hl-comment", line);

    // Document markers
    if (/^---/.test(line.trim()) || /^\.\.\./.test(line.trim()))
      return span("hl-comment", line);

    // Key: value  — match "  key: rest" (key may contain dots, slashes, etc.)
    const kv = line.match(/^(\s*)([\w.\/\-]+)(\s*:\s*)(.*)$/);
    if (kv) {
      const [, indent, key, sep, val] = kv;
      return esc(indent) + span("hl-key", key) + esc(sep) + yamlValue(val);
    }

    // List bullet
    const li = line.match(/^(\s*-\s*)(.*)$/);
    if (li) {
      const [, bullet, val] = li;
      return span("hl-punct", bullet) + yamlValue(val);
    }

    return esc(line);
  }).join("\n");
}

function yamlValue(val: string): string {
  if (!val) return "";
  const t = val.trim();
  if (t === "null" || t === "~")              return span("hl-null", val);
  if (t === "true" || t === "false")          return span("hl-bool", val);
  if (/^-?\d+\.?\d*([eE][+-]?\d+)?$/.test(t)) return span("hl-num", val);
  if (/^['"]/.test(t))                        return span("hl-str", val);
  if (/^[|>][-+]?\s*$/.test(t))              return span("hl-str", val);
  return span("hl-val", val);
}

const codeHtml = computed(() => {
  if (!detailText.value) return "";
  return format.value === "json"
    ? highlightJson(detailText.value)
    : highlightYaml(detailText.value);
});

function copyDetail() {
  navigator.clipboard?.writeText(detailText.value).catch(() => {});
}

onMounted(loadTypes);
watch(current, loadTypes);
</script>

<template>
  <section class="explore">

    <!-- Toolbar: just title + refresh -->
    <div class="toolbar">
      <h2 class="title">Explore <span class="ws">in {{ current }}</span></h2>
      <div class="toolbar-right">
        <button class="btn-refresh" @click="loadTypes" :disabled="loading">
          <svg :class="{ spin: loading }" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>
    </div>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <!-- Main split layout -->
    <div class="split">

      <!-- Types panel -->
      <div class="types-panel" :style="{ width: panelWidth + 'px' }">
        <!-- Panel header: label + count -->
        <div class="panel-head">
          <span class="panel-head-label">Resource types</span>
          <span class="panel-head-count">{{ filtered.length }}</span>
          <span v-if="filtered.length !== resources.length" class="panel-head-total">/ {{ resources.length }}</span>
        </div>

        <!-- Filter controls: search + category pills -->
        <div class="types-filter">
          <div class="filter-search-wrap">
            <svg class="filter-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input v-model="filter" class="filter-search" placeholder="Filter types…" />
            <button v-if="filter" class="filter-clear" @click="filter = ''" title="Clear">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="origin-pills">
            <button
              v-for="o in ORIGINS" :key="o"
              class="origin-pill" :class="[`pill-${o}`, { active: soloOrigin === o, dim: soloOrigin !== null && soloOrigin !== o }]"
              @click="toggleOrigin(o)"
              :title="soloOrigin === o ? 'Show all' : `Show only ${o}`"
            >{{ o }}</button>
          </div>
        </div>

        <div class="types-list">
          <p v-if="loading" class="hint">Discovering…</p>
          <template v-else>
            <div
              v-for="r in filtered"
              :key="r.groupVersion + '/' + r.name"
              class="type-row"
              :class="[`origin-${r.origin}`, { active: selected === r }]"
              @click="select(r)"
            >
              <div class="type-main">
                <div class="type-top">
                  <span class="kind">{{ r.kind }}</span>
                  <span class="scope" :title="r.namespaced ? 'Namespaced' : 'Cluster-scoped'">
                    {{ r.namespaced ? "ns" : "cl" }}
                  </span>
                </div>
                <div class="type-bottom">
                  <span class="origin-dot" :class="`dot-${r.origin}`"></span>
                  <span class="gv">{{ r.group || "core" }}/{{ r.version }}</span>
                </div>
              </div>
            </div>
            <p v-if="!filtered.length" class="hint">No matching types</p>
          </template>
        </div>
      </div>

      <!-- Drag handle -->
      <div class="splitter" @mousedown.prevent="onSplitterMousedown">
        <div class="splitter-grip"></div>
      </div>

      <!-- Objects panel -->
      <div class="objects-panel">
        <div v-if="!selected" class="empty-state">
          <span class="empty-icon">←</span>
          Select a resource type
        </div>
        <template v-else>
          <div class="panel-head">
            <span class="panel-head-label">{{ selected.kind }}</span>
            <span class="panel-head-count">{{ objects.length }}</span>
            <span class="panel-head-gv">{{ selected.group || "core" }}/{{ selected.version }}</span>
          </div>
          <div class="objects-body">
            <p v-if="objError" class="error-banner" style="margin: 0.75rem">{{ objError }}</p>
            <p v-if="objLoading" class="hint" style="padding: 1rem">Loading…</p>
            <table v-else-if="objects.length" class="obj-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th v-if="selected.namespaced">Namespace</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="o in objects"
                  :key="(o.metadata.namespace || '') + '/' + o.metadata.name"
                  @click="detail = o"
                >
                  <td class="obj-name">{{ o.metadata.name }}</td>
                  <td v-if="selected.namespaced" class="obj-ns">{{ o.metadata.namespace || "—" }}</td>
                  <td class="obj-age">{{ age(o.metadata.creationTimestamp) }}</td>
                </tr>
              </tbody>
            </table>
            <div v-else-if="!objError && !objLoading" class="empty-state">
              <span class="empty-icon">∅</span>
              No objects of this type
            </div>
          </div>
        </template>
      </div>

    </div>

    <!-- Detail drawer -->
    <div v-if="detail" class="drawer-backdrop" @click.self="detail = null">
      <div class="drawer">

        <div class="drawer-head">
          <div class="drawer-title">
            <span class="drawer-kind">{{ detail.kind || selected?.kind }}</span>
            <span class="drawer-sep">/</span>
            <span class="drawer-name">{{ detail.metadata.name }}</span>
          </div>
          <div class="drawer-actions">
            <div class="fmt-switch">
              <button :class="{ on: format === 'yaml' }" @click="format = 'yaml'">YAML</button>
              <button :class="{ on: format === 'json' }" @click="format = 'json'">JSON</button>
            </div>
            <button
              class="drawer-btn"
              :class="{ 'drawer-btn--amber': !hideManagedFields }"
              @click="hideManagedFields = !hideManagedFields"
              :title="hideManagedFields ? 'Show managed fields' : 'Hide managed fields'"
            >
              <!-- eye-slash -->
              <svg v-if="hideManagedFields" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              <!-- eye -->
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              managedFields
            </button>
            <button class="drawer-btn" @click="copyDetail" title="Copy to clipboard">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copy
            </button>
            <button class="drawer-btn drawer-btn--close" @click="detail = null" title="Close">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Code area -->
        <div class="code-wrap">
          <pre class="code" v-html="codeHtml"></pre>
        </div>

      </div>
    </div>

  </section>
</template>

<style scoped>
/* ── Page shell ── */
.explore {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 0;
  overflow: hidden;
  /* Fill the .content flex column */
  height: 100%;
}

/* ── Toolbar ── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem 0;
  flex: none;
}
.toolbar-right { display: flex; align-items: center; gap: 0.5rem; flex: none; }

/* ── Error banner ── */
.error-banner {
  color: #be123c;
  background: #fff1f2;
  border: 1px solid #fecdd3;
  border-radius: 6px;
  padding: 0.5rem 0.8rem;
  font-size: 0.82rem;
  margin: 0 0 0.75rem;
  flex: none;
}

.title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  white-space: nowrap;
}
.ws {
  font-size: 0.82rem;
  font-weight: 400;
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.chips { display: flex; gap: 0.3rem; flex-wrap: wrap; }
.chip {
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0.15rem 0.65rem;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.12s;
}
.chip.off { opacity: 0.3; }
.native    { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.kcp       { background: #faf5ff; color: #7c3aed; border-color: #ddd6fe; text-transform: none; }
.crd       { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.apibinding{ background: #fff7ed; color: #c2410c; border-color: #fed7aa; }

.search {
  padding: 0.35rem 0.65rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.82rem;
  outline: none;
  width: 180px;
  background: #fff;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.search:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}

/* ── Types filter bar ── */
.types-filter {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid #f1f5f9;
  background: #fff;
  flex: none;
}
.filter-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.filter-icon {
  position: absolute;
  left: 0.5rem;
  color: #94a3b8;
  pointer-events: none;
  flex: none;
}
.filter-search {
  width: 100%;
  padding: 0.32rem 1.8rem 0.32rem 1.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.78rem;
  font-family: inherit;
  outline: none;
  background: #f8fafc;
  color: #1e293b;
  transition: border-color 0.12s, box-shadow 0.12s, background 0.12s;
  box-sizing: border-box;
}
.filter-search:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99,102,241,0.12);
  background: #fff;
}
.filter-clear {
  position: absolute;
  right: 0.4rem;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 0.15rem;
  display: flex;
  align-items: center;
  border-radius: 3px;
  transition: color 0.1s;
}
.filter-clear:hover { color: #475569; }

/* Category pills */
.origin-pills {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.origin-pill {
  border-radius: 999px;
  padding: 0.18rem 0.6rem;
  font-size: 0.68rem;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.15s, transform 0.1s;
}
.origin-pill.dim { opacity: 0.28; }
.origin-pill.active { opacity: 1; box-shadow: 0 0 0 2px currentColor; }

/* per-category colours (same palette as before) */
.pill-native     { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.pill-kcp        { background: #faf5ff; color: #7c3aed; border-color: #ddd6fe; }
.pill-crd        { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.pill-apibinding { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }

/* count annotation */
.panel-head-total {
  font-size: 0.68rem;
  color: #94a3b8;
}
.btn-refresh {
  padding: 0.35rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  font-size: 0.82rem;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s;
}
.btn-refresh:hover:not(:disabled) { background: #f1f5f9; }
.btn-refresh:disabled { opacity: 0.5; cursor: default; }

/* ── Split layout ── */
.split {
  display: flex;
  flex: 1;
  min-height: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

/* ── Types panel ── */
.types-panel {
  display: flex;
  flex-direction: column;
  flex: none;
  min-width: 160px;
  max-width: 520px;
  overflow: hidden;
  border-right: 1px solid #e2e8f0;
}
.types-list {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
}

/* ── Splitter ── */
.splitter {
  width: 5px;
  flex: none;
  background: #f1f5f9;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s;
  position: relative;
  z-index: 1;
}
.splitter:hover,
.splitter:active { background: #cbd5e1; }
.splitter-grip {
  width: 1px;
  height: 32px;
  background: #94a3b8;
  border-radius: 1px;
  opacity: 0.5;
}

/* ── Objects panel ── */
.objects-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.objects-body {
  flex: 1;
  overflow-y: auto;
}

/* ── Shared panel head ── */
.panel-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
  flex: none;
}
.panel-head-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.panel-head-count {
  font-size: 0.7rem;
  font-weight: 600;
  background: #e2e8f0;
  color: #64748b;
  border-radius: 999px;
  padding: 0 0.4rem;
}
.panel-head-gv {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.7rem;
  color: #94a3b8;
}

/* ── Type rows ── */
.type-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid #f8fafc;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.08s;
}
.type-row:last-child { border-bottom: none; }
.type-row:hover  { background: #f8fafc; }
.type-row.active { background: #eff6ff; }

.origin-native     { border-left-color: #3b82f6; }
.origin-kcp        { border-left-color: #8b5cf6; }
.origin-crd        { border-left-color: #22c55e; }
.origin-apibinding { border-left-color: #f97316; }

.type-main {
  flex: 1;
  min-width: 0;
  padding: 0.42rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}
.type-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  min-width: 0;
}
.kind {
  font-weight: 600;
  font-size: 0.83rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  color: #1e293b;
}
.type-row.active .kind { color: #1d4ed8; }
.scope {
  flex: none;
  font-size: 0.62rem;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #94a3b8;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  padding: 0 0.25rem;
}
.type-bottom {
  display: flex;
  align-items: center;
  gap: 0.28rem;
  min-width: 0;
}
.origin-dot {
  width: 5px; height: 5px;
  border-radius: 50%; flex: none;
}
.dot-native     { background: #3b82f6; }
.dot-kcp        { background: #8b5cf6; }
.dot-crd        { background: #22c55e; }
.dot-apibinding { background: #f97316; }
.gv {
  font-size: 0.68rem;
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* ── Objects table ── */
.obj-table {
  width: 100%;
  border-collapse: collapse;
}
.obj-table th {
  position: sticky; top: 0;
  background: #f8fafc;
  text-align: left;
  padding: 0.4rem 0.85rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  border-bottom: 1px solid #e2e8f0;
  z-index: 1;
}
.obj-table tbody tr {
  cursor: pointer;
  transition: background 0.08s;
}
.obj-table tbody tr:hover { background: #f8fafc; }
.obj-table td {
  padding: 0.42rem 0.85rem;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.82rem;
}
.obj-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  font-weight: 600;
  color: #2563eb;
}
.obj-ns  { color: #475569; font-size: 0.78rem; }
.obj-age { color: #94a3b8; font-size: 0.75rem; white-space: nowrap; }

/* ── Empty / hint ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  height: 100%;
  min-height: 140px;
  color: #94a3b8;
  font-size: 0.85rem;
}
.empty-icon { font-size: 1.4rem; opacity: 0.5; }
.hint { color: #94a3b8; font-size: 0.82rem; padding: 0.6rem 0.75rem; margin: 0; }

/* ── Drawer ── */
.drawer-backdrop {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex; justify-content: flex-end;
  z-index: 50;
}
.drawer {
  width: min(720px, 92vw);
  background: #fff;
  height: 100%;
  display: flex; flex-direction: column;
  box-shadow: -4px 0 32px rgba(0,0,0,0.12);
  border-left: 1px solid #e2e8f0;
}

/* Drawer header */
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  flex: none;
  gap: 0.75rem;
  background: #f8fafc;
}
.drawer-title {
  display: flex; align-items: center; gap: 0.35rem;
  min-width: 0; overflow: hidden;
}
.drawer-kind {
  font-size: 0.82rem;
  font-weight: 700;
  color: #4f46e5;
  white-space: nowrap;
}
.drawer-sep {
  color: #cbd5e1;
  font-size: 0.82rem;
}
.drawer-name {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 0.78rem;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* Drawer action bar */
.drawer-actions {
  display: flex; gap: 0.35rem; align-items: center; flex: none;
}
.drawer-btn {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-family: inherit;
  font-size: 0.72rem; font-weight: 600;
  padding: 0.28rem 0.6rem;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.drawer-btn:hover { background: #f1f5f9; color: #1e293b; border-color: #cbd5e1; }
.drawer-btn--amber { background: #fffbeb; color: #92400e; border-color: #fde68a; }
.drawer-btn--amber:hover { background: #fef3c7; }
.drawer-btn--close { padding: 0.28rem 0.45rem; }
.drawer-btn--close:hover { background: #fef2f2; color: #ef4444; border-color: #fecaca; }

/* Format switch */
.fmt-switch {
  display: inline-flex;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
}
.fmt-switch button {
  font-family: inherit;
  border: none; border-radius: 0;
  background: #fff;
  color: #94a3b8;
  font-size: 0.7rem; font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.28rem 0.65rem;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.fmt-switch button + button { border-left: 1px solid #e2e8f0; }
.fmt-switch button:hover { color: #1e293b; background: #f1f5f9; }
.fmt-switch button.on { background: #6366f1; color: #fff; }

/* Code area */
.code-wrap {
  flex: 1;
  overflow: auto;
  background: #f8fafc;
  background-image: linear-gradient(
    to right,
    #f1f5f9 0px,
    #f1f5f9 44px,
    transparent 44px
  );
}
.code {
  margin: 0;
  padding: 1.1rem 1.1rem 1.1rem 56px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Menlo, monospace;
  font-size: 0.8rem;
  line-height: 1.65;
  color: #1e293b;
  white-space: pre;
  tab-size: 2;
  overflow: visible;
  min-width: max-content;
}

/* ── Token colours (GitHub light-inspired) ── */
.code :deep(.hl-key)     { color: #0550ae; }   /* blue   — keys */
.code :deep(.hl-str)     { color: #116329; }   /* green  — strings */
.code :deep(.hl-num)     { color: #cf222e; }   /* red    — numbers */
.code :deep(.hl-bool)    { color: #8250df; }   /* purple — booleans */
.code :deep(.hl-null)    { color: #cf222e; }   /* red    — null */
.code :deep(.hl-val)     { color: #1e293b; }   /* base   — bare string values */
.code :deep(.hl-comment) { color: #6e7781; font-style: italic; }
.code :deep(.hl-punct)   { color: #94a3b8; }   /* grey   — list bullets */

@keyframes spin { to { transform: rotate(360deg); } }
.spin { display: inline-block; animation: spin 0.8s linear infinite; }
</style>

